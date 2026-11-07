import type { HubDocument } from '../../shared/project-hub-types'
import {
  isHubStageNativePlanRequest, type HubStageNativePlanRequest,
  type HubStageNativePlanResult
} from '../../shared/project-hub-supervised-stage'
import type { NativePlanPreview } from '../../shared/native-plan-preview'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import { NativePlanMaterializer } from '../runtime/adaptive-delivery/native-plan-materializer'
import type { AdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'
import { buildNativePlanPreview } from './native-plan-preview'
import { hubStageAdmission } from './native-stage-identity'
import { inspectHubNativeStages } from './native-stage-recovery'

/** Verified by the owning host's repository resolver and fresh native Git read. */
export type VerifiedHubStageWorktree = {
  worktreeId: string
  repoId: string
  projectId: string
  hostId: string
  baseSha: string
}

export type HubStageHostDependencies = {
  readProject: (id: string) => HubDocument
  inspectWorktree: (id: string) => Promise<VerifiedHubStageWorktree>
  confirmInHostWindow: (details: {
    preview: NativePlanPreview
    worktree: VerifiedHubStageWorktree
  }) => Promise<boolean>
  getOrchestrationDb: () => OrchestrationDb
}

function verifiedTarget(
  request: HubStageNativePlanRequest,
  worktree: VerifiedHubStageWorktree
): void {
  if (worktree.projectId !== request.projectId ||
      worktree.worktreeId !== request.worktreeId ||
      worktree.hostId !== LOCAL_EXECUTION_HOST_ID ||
      !worktree.repoId || !/^[a-f0-9]{40}$/i.test(worktree.baseSha)) {
    throw new Error('Host workspace, repository or Git HEAD cannot be verified')
  }
}

function approvedPreview(
  dependencies: HubStageHostDependencies,
  request: HubStageNativePlanRequest
): NativePlanPreview {
  const preview = buildNativePlanPreview(
    dependencies.readProject(request.projectId), request.planId, request.expectedRevision
  )
  if (preview.approval !== 'accepted' || preview.planSha !== request.planSha) {
    throw new Error('Fresh approved plan SHA required before materialization')
  }
  return preview
}

/**
 * This is a host-confirmed *control-plane* write, not orchestration execution.
 * A native Electron dialog is the human consent source; renderer approval alone
 * never writes a scope grant. Revalidate plan, owner and Git HEAD after consent.
 *
 * Stable operation IDs prevent replay from silently creating a second Run.
 * Incomplete/unknown ledger outcomes require host reconciliation, not retry.
 */
export async function stageHubNativePlan(
  raw: unknown,
  host: HubStageHostDependencies
): Promise<HubStageNativePlanResult> {
  if (!isHubStageNativePlanRequest(raw)) { throw new Error('Invalid supervised stage request') }
  const request = raw
  const preview = approvedPreview(host, request)
  const initial = await host.inspectWorktree(request.worktreeId)
  verifiedTarget(request, initial)
  if (!await host.confirmInHostWindow({ preview, worktree: initial })) {
    return { status: 'cancelled' }
  }

  const current = approvedPreview(host, request)
  const verified = await host.inspectWorktree(request.worktreeId)
  verifiedTarget(request, verified)
  if (JSON.stringify(verified) !== JSON.stringify(initial) ||
      current.planSha !== preview.planSha) {
    throw new Error('Project/worktree or Git HEAD changed while confirming; retry inspection')
  }

  const admission = hubStageAdmission({
    projectId: request.projectId, repoId: verified.repoId,
    hostId: verified.hostId, worktreeId: verified.worktreeId,
    baseSha: verified.baseSha, planId: request.planId,
    planSha: current.planSha, taskIds: current.tasks.map(task => task.id)
  })
  const { scopeId, requestId } = admission
  const db = host.getOrchestrationDb()
  // A previous interrupted materialization of this plan/worktree, even at
  // a different HEAD, must be reconciled before another irreversible write.
  if (inspectHubNativeStages(db, current, verified).status === 'needs_reconciliation') {
    throw new Error('Uncertain previous native Run; reconcile before another materialization')
  }
  const ledger = new HostAdmissionLedger(db)
  const previous = ledger.getReservation(requestId)
  if (!previous) {
    // A dangling scope after an interrupted grant must be reconciled rather than
    // widened or reissued; later calls will never generate a second Run.
    const existing = db.db.prepare(
      'SELECT id FROM adaptive_scope_grants WHERE id = ?'
    ).get(scopeId)
    if (existing) { throw new Error('Host grant pending without receipt; reconcile first') }
    const scope: AdaptiveScope = {
      projectId: admission.projectId, repoId: admission.repoId,
      hostId: admission.hostId, baseSha: admission.baseSha,
      planId: admission.planId, planSha: admission.planSha,
      allowedTaskIds: [...admission.taskIds], operations: ['materialize_run'],
      maxOperations: 1, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    }
    ledger.recordHostApproval(scopeId, scope)
  }
  const materializer = new NativePlanMaterializer(db, ledger, {
    read: host.readProject
  })
  const receipt = materializer.materialize({
    admission, expectedHubRevision: request.expectedRevision, nowMs: Date.now()
  })
  return {
    status: 'staged', projectId: request.projectId, planId: receipt.planId,
    runId: receipt.runId, tasks: receipt.tasks, baseSha: verified.baseSha,
    reused: previous?.state === 'completed', dispatched: false
  }
}
