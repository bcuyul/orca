import { createHash } from 'node:crypto'
import type { HubDocument } from '../../shared/project-hub-types'
import {
  isHubStageNativePlanRequest, type HubStageNativePlanRequest
} from '../../shared/project-hub-supervised-stage'
import type { NativePlanPreview } from '../../shared/native-plan-preview'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AdaptiveScope, AdaptiveRequest } from '../../shared/adaptive-delivery/admission-contracts'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import {
  HostExecutionPermitStore, type VerifiedExecutionDecision,
  type PreparedExecutionPermit
} from '../runtime/adaptive-delivery/host-execution-permit'
import {
  requireVerifiedAgentSandbox, type VerifiedAgentSandboxReader
} from '../runtime/adaptive-delivery/execution-sandbox-policy'
import { evaluateHubWorkerReadiness } from '../../shared/project-hub-worker-readiness'
import { buildNativePlanPreview } from './native-plan-preview'
import { inspectHubNativeStages } from './native-stage-recovery'
import { hubStageAdmission } from './native-stage-identity'
import type { VerifiedHubStageWorktree } from './supervised-native-plan-stage'

export type HubWorkerPermitRequest = HubStageNativePlanRequest & {
  hubTaskId: string
}
export type HubWorkerPermitHostDependencies = {
  readProject: (projectId: string) => HubDocument
  inspectWorktree: (worktreeId: string) => Promise<VerifiedHubStageWorktree>
  getOrchestrationDb: () => OrchestrationDb
  sandbox: VerifiedAgentSandboxReader
  confirmOneTurnInHostWindow: (details: {
    preview: NativePlanPreview
    worktree: VerifiedHubStageWorktree
    hubTaskId: string
    nativeTaskId: string
    nativeRunId: string
  }) => Promise<boolean>
}
export type HubWorkerPermitOutcome =
  | { status: 'cancelled'; dispatched: false; executionAuthorized: false }
  | {
    status: 'prepared'
    permit: PreparedExecutionPermit
    dispatched: false
    executionAuthorized: false
  }

function target(request: HubWorkerPermitRequest, worktree: VerifiedHubStageWorktree): void {
  if (worktree.projectId !== request.projectId ||
      worktree.worktreeId !== request.worktreeId ||
      worktree.hostId !== LOCAL_EXECUTION_HOST_ID ||
      !worktree.repoId || !/^[a-f0-9]{40}$/i.test(worktree.baseSha)) {
    throw new Error('Host worktree/Git ownership could not be verified')
  }
}

function approved(
  host: HubWorkerPermitHostDependencies,
  request: HubWorkerPermitRequest
): NativePlanPreview {
  const preview = buildNativePlanPreview(
    host.readProject(request.projectId), request.planId, request.expectedRevision
  )
  if (preview.approval !== 'accepted' || preview.planSha !== request.planSha ||
      preview.dispatched !== false) {
    throw new Error('Only a current approved plan may request a worker permit')
  }
  return preview
}

function digestIdentity(input: {
  projectId: string; repoId: string; hostId: string; worktreeId: string
  baseSha: string; planId: string; planSha: string
  hubTaskId: string; nativeTaskId: string; nativeRunId: string
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 40)
}

function verifiedCandidate(
  host: HubWorkerPermitHostDependencies,
  request: HubWorkerPermitRequest,
  worktree: VerifiedHubStageWorktree,
  db: OrchestrationDb
): { preview: NativePlanPreview; runId: string; taskId: string } {
  const preview = approved(host, request)
  const recovery = inspectHubNativeStages(db, preview, worktree)
  const readiness = evaluateHubWorkerReadiness(preview, recovery)
  if (readiness.status !== 'candidates-only' || !readiness.runId ||
      recovery.entries[0]?.baseSha !== worktree.baseSha) {
    throw new Error('One fully verified staged Run at the current Git SHA is required')
  }
  const candidate = readiness.candidates.find(t => t.taskId === request.hubTaskId)
  if (!candidate) {
    throw new Error('Only a dependency-free, verified plan task is selectable')
  }
  return { preview, runId: readiness.runId, taskId: candidate.nativeTaskId }
}

/**
 * Production-capable host-only control-plane gate, but deliberately NOT wired
 * to a renderer endpoint or CLI. The caller MUST provide a trusted native
 * human decision and an OS-enforced sandbox reader. A worktree-only sandbox
 * fails BEFORE permission grants are written.
 *
 * Approval reserves exactly one agent_turn, NOT an actual token cap. No prompt,
 * terminal, Dispatch or underlying task spec can be changed by this service.
 */
export async function prepareHubOneWorkerPermit(
  raw: unknown,
  host: HubWorkerPermitHostDependencies
): Promise<HubWorkerPermitOutcome> {
  if (!isHubStageNativePlanRequest(raw) ||
      typeof (raw as HubWorkerPermitRequest).hubTaskId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(
        (raw as HubWorkerPermitRequest).hubTaskId
      )) {
    throw new Error('Invalid native worker-permit request')
  }
  const request = raw as HubWorkerPermitRequest
  const original = await host.inspectWorktree(request.worktreeId)
  target(request, original)
  const db = host.getOrchestrationDb()
  const selected = verifiedCandidate(host, request, original, db)

  // Fail closed before asking for consent: Git worktree alone is not a sandbox.
  const sandboxTarget = {
    hostId: original.hostId, repoId: original.repoId,
    worktreeId: original.worktreeId, baseSha: original.baseSha
  }
  requireVerifiedAgentSandbox(host.sandbox, sandboxTarget)
  if (!await host.confirmOneTurnInHostWindow({
    preview: selected.preview, worktree: original,
    hubTaskId: request.hubTaskId,
    nativeTaskId: selected.taskId, nativeRunId: selected.runId
  })) {
    return { status: 'cancelled', dispatched: false, executionAuthorized: false }
  }

  const current = await host.inspectWorktree(request.worktreeId)
  target(request, current)
  if (JSON.stringify(current) !== JSON.stringify(original)) {
    throw new Error('Git worktree changed while confirming the worker permit')
  }
  const again = verifiedCandidate(host, request, current, db)
  if (again.runId !== selected.runId || again.taskId !== selected.taskId ||
      again.preview.planSha !== selected.preview.planSha) {
    throw new Error('Staged Run or task changed during consent')
  }
  requireVerifiedAgentSandbox(host.sandbox, sandboxTarget)

  const identity = {
    projectId: request.projectId, repoId: current.repoId, hostId: current.hostId,
    worktreeId: current.worktreeId, baseSha: current.baseSha,
    planId: request.planId, planSha: selected.preview.planSha,
    hubTaskId: request.hubTaskId,
    nativeTaskId: selected.taskId, nativeRunId: selected.runId
  }
  const digest = digestIdentity(identity)
  const scopeId = `hub-one-turn-${digest}`
  const requestId = `hub-one-turn-request-${digest}`
  const decisionId = `hub-one-turn-decision-${digest}`
  const nowMs = Date.now()
  const expiresAtMs = nowMs + 5 * 60_000
  const admission: AdaptiveRequest = {
    requestId, scopeId, projectId: request.projectId,
    repoId: current.repoId, hostId: current.hostId,
    baseSha: current.baseSha, planId: request.planId,
    planSha: selected.preview.planSha,
    taskIds: [request.hubTaskId], operation: 'agent_turn'
  }
  const scope: AdaptiveScope = {
    projectId: admission.projectId, repoId: admission.repoId,
    hostId: admission.hostId, baseSha: admission.baseSha,
    planId: admission.planId, planSha: admission.planSha,
    allowedTaskIds: [request.hubTaskId], operations: ['agent_turn'],
    maxOperations: 1, expiresAt: new Date(expiresAtMs).toISOString()
  }
  const originalStage = hubStageAdmission({
    projectId: request.projectId, repoId: current.repoId,
    hostId: current.hostId, worktreeId: current.worktreeId,
    baseSha: current.baseSha, planId: request.planId,
    planSha: request.planSha, taskIds: selected.preview.tasks.map(t => t.id)
  })
  const ledger = new HostAdmissionLedger(db)
  const prior = ledger.getReservation(requestId)
  if (!prior) {
    const dangling = db.db.prepare(
      'SELECT 1 FROM adaptive_scope_grants WHERE id = ?'
    ).get(scopeId)
    if (dangling) {
      throw new Error('Execution grant exists without receipt; reconcile first')
    }
    ledger.recordHostApproval(scopeId, scope)
  }

  const decision: VerifiedExecutionDecision = {
    id: decisionId, projectId: request.projectId,
    repoId: current.repoId, hostId: current.hostId,
    baseSha: current.baseSha, planId: request.planId,
    planSha: request.planSha, runId: selected.runId,
    taskId: selected.taskId, worktreeId: current.worktreeId,
    approvedAtMs: nowMs, expiresAtMs, maxTurns: 1
  }
  const permits = new HostExecutionPermitStore(
    db, ledger,
    { readVerifiedExecutionDecision: id => id === decisionId ? decision : null },
    { readVerifiedWorktree: () => ({
      repoId: current.repoId, hostId: current.hostId,
      worktreeId: current.worktreeId, baseSha: current.baseSha
    }) },
    host.sandbox
  )
  const permit = permits.prepare({
    admission, materializationRequestId: originalStage.requestId,
    nativeRunId: selected.runId, nativeTaskId: selected.taskId,
    worktreeId: current.worktreeId, decisionId, nowMs
  })
  return { status: 'prepared', permit, dispatched: false, executionAuthorized: false }
}
