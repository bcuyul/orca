import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { assertAdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'
import type {
  VerifiedHubWorkerDispatchTarget
} from './host-worker-atomic-dispatch'

/**
 * Read-only inspection of durable Dispatch claims. A claim proves reservation,
 * NOT that an agent received a prompt or that QA was completed.
 *
 * No HostAdmissionLedger constructor here: it installs SQL triggers/tables.
 * No retry, lifecycle transition, sandbox claim or CLI is exposed.
 */
export type HubDispatchRecoveryIdentity = Pick<
  VerifiedHubWorkerDispatchTarget,
  'projectId' | 'repoId' | 'hostId' | 'worktreeId' | 'planId' | 'planSha'
>
export type HubDispatchRecoveryEntry = {
  permitRequestId: string
  runId: string
  taskId: string
  dispatchId: string
  taskStatus: string | null
  dispatchStatus: string | null
  evidence: 'matched' | 'divergent'
  disposition: 'reserved_unobserved' | 'settled_unverified' | 'manual_reconciliation'
}
export type HubDispatchRecoveryReport = {
  status: 'not_found' | 'reserved_unobserved' |
    'settled_unverified' | 'needs_reconciliation'
  entries: HubDispatchRecoveryEntry[]
  safeToResend: false
  executionAuthorized: false
  deliveryVerified: false
}

type Claim = {
  permit_request_id: string
  run_id: string
  task_id: string
  dispatch_id: string
  scope_id: string
  assignee_handle: string
  identity_json: string
  receipt_json: string
  scope_json: string
  revoked: number
}
type Permit = {
  request_id: string; decision_id: string; run_id: string; task_id: string
  worktree_id: string; base_sha: string; status: string
}
type Admission = {
  request_id: string; scope_id: string; operation: string
  state: string; receipt: string | null
}

const MAX_ENTRIES = 100
const EMPTY: HubDispatchRecoveryReport = {
  status: 'not_found', entries: [], safeToResend: false,
  executionAuthorized: false, deliveryVerified: false
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
function readObject(value: string): Record<string, unknown> | null {
  try { return object(JSON.parse(value)) } catch { return null }
}
function matchFields(
  found: Record<string, unknown>,
  wanted: Record<string, string>,
  keys: readonly string[]
): boolean {
  return keys.every(key => found[key] === wanted[key])
}
function validSelection(identity: HubDispatchRecoveryIdentity): void {
  if (!identity || ![
    identity.projectId, identity.repoId, identity.hostId,
    identity.worktreeId, identity.planId
  ].every(id => typeof id === 'string' && id.length > 0 && id.length <= 600) ||
    !/^[a-f0-9]{64}$/i.test(identity.planSha)) {
    throw new Error('Invalid host-owned Project Hub recovery identity')
  }
}
function recoverClaim(
  db: OrchestrationDb,
  claim: Claim,
  scope: Record<string, unknown>,
  target: Record<string, unknown>,
  terminal: Record<string, unknown>
): HubDispatchRecoveryEntry {
  const task = db.getTask(claim.task_id)
  const dispatch = db.getDispatchContextById(claim.dispatch_id)
  const result: HubDispatchRecoveryEntry = {
    permitRequestId: claim.permit_request_id,
    runId: claim.run_id, taskId: claim.task_id, dispatchId: claim.dispatch_id,
    taskStatus: task?.status ?? null,
    dispatchStatus: dispatch?.status ?? null,
    evidence: 'divergent', disposition: 'manual_reconciliation'
  }
  const permit = db.db.prepare(
    'SELECT request_id,decision_id,run_id,task_id,worktree_id,base_sha,status ' +
    'FROM adaptive_execution_permits WHERE request_id = ?'
  ).get(claim.permit_request_id) as Permit | undefined
  const admission = db.db.prepare(
    'SELECT request_id,scope_id,operation,state,receipt ' +
    'FROM adaptive_admissions WHERE request_id = ?'
  ).get(claim.permit_request_id) as Admission | undefined
  const receipt = readObject(claim.receipt_json)
  const approved = admission?.receipt ? readObject(admission.receipt) : null
  const spec = task ? readObject(task.spec) : null

  const targetIds = [
    'projectId', 'repoId', 'hostId', 'planId', 'planSha', 'baseSha'
  ]
  const scopeFieldsMatch = targetIds.every(key => scope[key] === target[key])
  const permitted = scope.operations
  const allowed = scope.allowedTaskIds
  const scopeMatches = scopeFieldsMatch &&
    Array.isArray(permitted) && permitted.length === 1 && permitted[0] === 'agent_turn' &&
    Array.isArray(allowed) && allowed.length === 1 &&
    allowed[0] === target.hubTaskId && scope.maxOperations === 1 &&
    claim.revoked === 0
  const identityMatches = target.permitRequestId === claim.permit_request_id &&
    target.nativeRunId === claim.run_id &&
    target.nativeTaskId === claim.task_id &&
    typeof target.baseSha === 'string' && /^[a-f0-9]{40}$/i.test(target.baseSha)
  const receiptMatches = receipt &&
    receipt.permitRequestId === claim.permit_request_id &&
    receipt.runId === claim.run_id && receipt.taskId === claim.task_id &&
    receipt.dispatchId === claim.dispatch_id &&
    receipt.assigneeHandle === claim.assignee_handle &&
    receipt.state === 'dispatch_reserved' &&
    receipt.workerStarted === false && receipt.modelCalls === 0
  const permitMatches = permit && permit.status === 'prepared' &&
    permit.request_id === claim.permit_request_id &&
    permit.run_id === claim.run_id && permit.task_id === claim.task_id &&
    permit.worktree_id === target.worktreeId && permit.base_sha === target.baseSha
  const approvalMatches = approved &&
    approved.requestId === claim.permit_request_id &&
    approved.runId === claim.run_id && approved.taskId === claim.task_id &&
    approved.decisionId === permit?.decision_id && approved.state === 'prepared'
  const admissionMatches = admission?.operation === 'agent_turn' &&
    admission.scope_id === claim.scope_id &&
    admission.state === 'completed'
  const taskMatches = task && db.getRun(claim.run_id) &&
    task.run_id === claim.run_id &&
    spec?.source === 'adaptive-supervised-native-worker' &&
    spec.permitRequestId === claim.permit_request_id
  const dispatchMatches = dispatch && dispatch.task_id === claim.task_id &&
    dispatch.run_id === claim.run_id &&
    dispatch.assignee_handle === claim.assignee_handle &&
    dispatch.assignee_handle === terminal.handle &&
    dispatch.assignee_pane_key === terminal.paneKey &&
    dispatch.process_incarnation === terminal.processIncarnation &&
    dispatch.launch_token_hash === terminal.launchTokenHash

  if (!scopeMatches || !identityMatches || !receiptMatches || !permitMatches ||
      !approvalMatches || !admissionMatches || !taskMatches || !dispatchMatches) {
    return result
  }

  if (task.status === 'dispatched' &&
      (dispatch.status === 'pending' || dispatch.status === 'dispatched')) {
    return { ...result, evidence: 'matched', disposition: 'reserved_unobserved' }
  }
  if ((task.status === 'completed' && dispatch.status === 'completed') ||
      (task.status === 'failed' &&
       ['failed', 'circuit_broken'].includes(dispatch.status))) {
    // Settlement in native SQLite alone is not trusted proof of agent output.
    return { ...result, evidence: 'matched', disposition: 'settled_unverified' }
  }
  return result
}

/**
 * Host-only recovery selector. Never assumes that a missing claim means a
 * permit or prompt is safe to retry. A different current Git HEAD does not
 * conceal older receipts pinned to this project/plan/worktree.
 */
export function inspectHubWorkerDispatches(
  db: OrchestrationDb,
  identity: HubDispatchRecoveryIdentity
): HubDispatchRecoveryReport {
  validSelection(identity)
  const required = [
    'adaptive_worker_dispatch_claims',
    'adaptive_scope_grants', 'adaptive_admissions',
    'adaptive_execution_permits'
  ]
  const tables = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" +
    required.map(() => '?').join(',') + ')'
  ).all(...required) as { name: string }[]
  if (!tables.some(row => row.name === 'adaptive_worker_dispatch_claims')) {
    return { ...EMPTY, entries: [] }
  }
  if (tables.length !== required.length) {
    return { ...EMPTY, status: 'needs_reconciliation', entries: [] }
  }

  // Read by the durable grant's plan identity, not the mutable task spec or
  // current Git HEAD; corrupt claims cannot simply disappear after a restart.
  const claims = db.db.prepare(
    'SELECT c.*, g.scope_json, g.revoked FROM adaptive_worker_dispatch_claims c ' +
    'JOIN adaptive_scope_grants g ON g.id = c.scope_id ' +
    "WHERE json_valid(g.scope_json) = 1 " +
    "AND json_extract(g.scope_json, '$.projectId') = ? " +
    "AND json_extract(g.scope_json, '$.repoId') = ? " +
    "AND json_extract(g.scope_json, '$.hostId') = ? " +
    "AND json_extract(g.scope_json, '$.planId') = ? " +
    "AND json_extract(g.scope_json, '$.planSha') = ? " +
    'ORDER BY c.rowid LIMIT ?'
  ).all(
    identity.projectId, identity.repoId, identity.hostId,
    identity.planId, identity.planSha, MAX_ENTRIES + 1
  ) as Claim[]
  if (claims.length > MAX_ENTRIES) {
    return { ...EMPTY, status: 'needs_reconciliation', entries: [] }
  }

  const entries: HubDispatchRecoveryEntry[] = []
  let corrupt = false
  for (const claim of claims) {
    const envelope = readObject(claim.identity_json)
    const target = envelope && object(envelope.target)
    const terminal = envelope && object(envelope.terminal)
    const parsedScope = readObject(claim.scope_json)
    if (!target || !terminal || !parsedScope) {
      corrupt = true
      continue
    }
    // This selection may contain other worktrees of the same plan. Do not
    // reveal their terminal details or misattribute them to this worktree.
    if (target.worktreeId !== identity.worktreeId) { continue }
    if (!matchFields(target, identity as unknown as Record<string, string>, [
      'projectId', 'repoId', 'hostId', 'worktreeId', 'planId', 'planSha'
    ])) {
      corrupt = true
      continue
    }
    try { assertAdaptiveScope(parsedScope) } catch { corrupt = true; continue }
    entries.push(recoverClaim(db, claim, parsedScope, target, terminal))
  }

  if (corrupt || entries.some(entry => entry.disposition === 'manual_reconciliation')) {
    return {
      status: 'needs_reconciliation', entries,
      safeToResend: false, executionAuthorized: false, deliveryVerified: false
    }
  }
  const status = entries.length === 0 ? 'not_found' :
    entries.some(entry => entry.disposition === 'reserved_unobserved') ?
      'reserved_unobserved' : 'settled_unverified'
  return {
    status, entries, safeToResend: false,
    executionAuthorized: false, deliveryVerified: false
  }
}
