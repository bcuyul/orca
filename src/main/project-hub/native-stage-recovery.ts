import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import { inspectNativeMaterialization } from '../runtime/adaptive-delivery/native-materialization-inspection'
import { assertAdaptiveScope, type AdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'
import type { NativePlanPreview } from '../../shared/native-plan-preview'
import type {
  HubNativeStageEvidence, HubNativeStageRecovery
} from '../../shared/project-hub-supervised-stage'
import { hubStageAdmission } from './native-stage-identity'
import type { VerifiedHubStageWorktree } from './supervised-native-plan-stage'

type Grant = { id: string; scope_json: string }

/** The ledger's Run existence check alone is not proof the task DAG survived
 * unmodified. Compare full source, role, acceptance and native predecessors. */
function nativeTaskDagMatches(
  db: OrchestrationDb,
  preview: NativePlanPreview,
  runId: string,
  tasks: Record<string, string>
): boolean {
  const run = db.getRun(runId)
  if (!run || run.objective !== preview.objective) { return false }
  for (const task of preview.tasks) {
    const native = db.getTask(tasks[task.id])
    if (!native || native.run_id !== runId) { return false }
    try {
      const spec: unknown = JSON.parse(native.spec)
      const deps: unknown = JSON.parse(native.deps)
      if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
          !('source' in spec) || spec.source !== 'adaptive-untrusted-plan' ||
          !('objective' in spec) || spec.objective !== preview.objective ||
          !('role' in spec) || spec.role !== task.role ||
          !('title' in spec) || spec.title !== task.title ||
          !('acceptance' in spec) || spec.acceptance !== task.acceptance ||
          !Array.isArray(deps) ||
          JSON.stringify(deps) !== JSON.stringify(task.dependsOn.map(id => tasks[id]))) {
        return false
      }
    } catch { return false }
  }
  return true
}

/**
 * Project-scoped, READ-ONLY recovery. Grants and admissions are already durable
 * in Orca's own SQLite; no parallel Project Hub store or runtime scheduler.
 * A change in Git HEAD does not hide older receipts or uncertain operations.
 */
export function inspectHubNativeStages(
  db: OrchestrationDb,
  preview: NativePlanPreview,
  worktree: Pick<VerifiedHubStageWorktree, 'projectId' | 'repoId' | 'hostId' | 'worktreeId'>
): HubNativeStageRecovery {
  const empty = (): HubNativeStageRecovery => ({
    status: 'not_found', entries: [], safeToRetry: false, executionAuthorized: false
  })
  if (preview.projectId !== worktree.projectId) {
    throw new Error('Project Hub host ownership mismatch')
  }
  const tables = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('adaptive_scope_grants','adaptive_admissions')"
  ).all() as { name: string }[]
  if (tables.length !== 2) { return empty() }

  // Limit query work, then fail closed instead of silently dropping older
  // uncertain materializations. SQLite's JSON1 path remains read-only.
  const grants = db.db.prepare(
    "SELECT id, scope_json FROM adaptive_scope_grants " +
    "WHERE json_valid(scope_json) = 1 " +
    "AND json_extract(scope_json, '$.projectId') = ? " +
    "AND json_extract(scope_json, '$.repoId') = ? " +
    "AND json_extract(scope_json, '$.hostId') = ? " +
    "AND json_extract(scope_json, '$.planId') = ? " +
    "AND json_extract(scope_json, '$.planSha') = ? LIMIT 101"
  ).all(
    worktree.projectId, worktree.repoId, worktree.hostId,
    preview.planId, preview.planSha
  ) as Grant[]
  if (grants.length > 100) {
    throw new Error('Too many native grant records; host reconciliation required')
  }

  // This object has no mutation methods. Avoid constructing HostAdmissionLedger:
  // its constructor would create tables/triggers, violating read-only recovery.
  const reader: Pick<HostAdmissionLedger, 'getReservation'> = {
    getReservation: (id) => db.db.prepare(
      'SELECT request_id,scope_id,payload_hash,operation,state,receipt FROM adaptive_admissions WHERE request_id = ?'
    ).get(id) as ReturnType<HostAdmissionLedger['getReservation']>
  }
  const taskIds = preview.tasks.map(task => task.id)
  const entries: HubNativeStageEvidence[] = []
  for (const grant of grants) {
    const parsed: unknown = JSON.parse(grant.scope_json)
    assertAdaptiveScope(parsed)
    const scope: AdaptiveScope = parsed
    // The same project/plan may also have independent agent_turn grants.
    // Those belong to worker admission, not materialization recovery.
    // A mixed grant claiming materialization still fails closed below.
    if (!scope.operations.includes('materialize_run')) { continue }
    if (scope.operations.length !== 1 || scope.operations[0] !== 'materialize_run' ||
        scope.maxOperations !== 1 ||
        [...scope.allowedTaskIds].sort().join('\0') !== [...taskIds].sort().join('\0')) {
      throw new Error('Native stage scope is not valid for this exact plan')
    }
    const request = hubStageAdmission({
      projectId: worktree.projectId, repoId: worktree.repoId,
      hostId: worktree.hostId, worktreeId: worktree.worktreeId,
      baseSha: scope.baseSha, planId: preview.planId,
      planSha: preview.planSha, taskIds
    })
    // Reject grants belonging to other worktrees. A grant carries the original
    // worktree hash, not a reversible worktree ID.
    if (grant.id !== request.scopeId) { continue }
    const evidence = inspectNativeMaterialization(db, reader, request)
    const reservation = reader.getReservation(request.requestId)
    let tasks: Record<string, string> | null = null
    let disposition: HubNativeStageEvidence['disposition'] = 'manual_reconciliation'
    let matchedEvidence: HubNativeStageEvidence['evidence'] = evidence.evidence
    if (evidence.disposition === 'completed_verified' && reservation?.receipt) {
      const raw: unknown = JSON.parse(reservation.receipt)
      if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
          'tasks' in raw && raw.tasks && typeof raw.tasks === 'object' &&
          !Array.isArray(raw.tasks)) {
        const mapped = raw.tasks as Record<string, string>
        if (evidence.runId && nativeTaskDagMatches(db, preview, evidence.runId, mapped)) {
          tasks = mapped
          disposition = 'completed_verified'
        } else {
          matchedEvidence = 'divergent'
        }
      }
    }
    entries.push({
      baseSha: scope.baseSha, state: evidence.state,
      evidence: matchedEvidence, disposition,
      runId: evidence.runId, tasks,
      recordedTaskCount: evidence.recordedTaskCount,
      unrecordedNativeTaskCount: evidence.unrecordedNativeTaskCount,
      dispatchCount: evidence.dispatchCount
    })
  }
  if (entries.length === 0) { return empty() }
  const status = entries.some(entry => entry.disposition === 'manual_reconciliation')
    ? 'needs_reconciliation' as const
    : entries.length > 1 ? 'multiple_verified' as const : 'completed_verified' as const
  return {
    status, entries: entries.sort((a, b) => a.baseSha.localeCompare(b.baseSha)),
    safeToRetry: false, executionAuthorized: false
  }
}
