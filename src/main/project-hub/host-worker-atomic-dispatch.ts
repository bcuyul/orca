import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import {
  requireVerifiedAgentSandbox, type VerifiedAgentSandboxReader
} from '../runtime/adaptive-delivery/execution-sandbox-policy'
import { assertAdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'
import { isAdaptiveStagedTaskSpec } from '../runtime/orchestration/adaptive-staged-task'

/**
 * Trusted host supplies the current worktree and terminal process authority.
 * Never build this object from a renderer request, CLI message or agent output.
 */
export type VerifiedHubWorkerDispatchTarget = {
  projectId: string
  repoId: string
  hostId: string
  worktreeId: string
  baseSha: string
  planId: string
  planSha: string
  hubTaskId: string
  nativeRunId: string
  nativeTaskId: string
  permitRequestId: string
}
export type VerifiedHubWorkerTerminal = {
  handle: string
  paneKey: string
  processIncarnation: string
  launchTokenHash: string
}
export type HubWorkerDispatchHost = {
  sandbox: VerifiedAgentSandboxReader
  readCurrentTarget: () => VerifiedHubWorkerDispatchTarget | null
  readVerifiedTerminal: (target: VerifiedHubWorkerDispatchTarget) =>
    VerifiedHubWorkerTerminal | null
}
export type HubReservedNativeDispatch = {
  permitRequestId: string
  runId: string
  taskId: string
  dispatchId: string
  assigneeHandle: string
  workerStarted: false
  modelCalls: 0
  state: 'dispatch_reserved'
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{0,199}$/
const SHA = /^[a-f0-9]{40}$/i
const DIGEST = /^[a-f0-9]{64}$/i

const SQL = `CREATE TABLE IF NOT EXISTS adaptive_worker_dispatch_claims (
  permit_request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  dispatch_id TEXT NOT NULL UNIQUE,
  scope_id TEXT NOT NULL,
  assignee_handle TEXT NOT NULL,
  identity_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL
)`

function validateTarget(target: VerifiedHubWorkerDispatchTarget): void {
  if (!target || ![
    target.projectId, target.repoId, target.hostId, target.worktreeId,
    target.planId, target.hubTaskId, target.nativeRunId, target.nativeTaskId,
    target.permitRequestId
  ].every(id => typeof id === 'string' && NAME.test(id)) ||
      !SHA.test(target.baseSha) || !DIGEST.test(target.planSha)) {
    throw new Error('Invalid trusted dispatch target')
  }
}

function validateTerminal(terminal: VerifiedHubWorkerTerminal | null): asserts terminal is VerifiedHubWorkerTerminal {
  if (!terminal || ![
    terminal.handle, terminal.paneKey, terminal.processIncarnation
  ].every(id => typeof id === 'string' && NAME.test(id)) ||
      !DIGEST.test(terminal.launchTokenHash)) {
    throw new Error('Authenticated host terminal/process identity required')
  }
}

type PermitRow = {
  request_id: string
  decision_id: string
  run_id: string
  task_id: string
  worktree_id: string
  base_sha: string
  status: string
}
type ClaimRow = {
  identity_json: string
  receipt_json: string
}

/**
 * One **atomic SQLite claim** for an independently prepared host permit.
 *
 * The old staged-task trigger stays strict: the task spec changes source and
 * the native Dispatch is inserted inside ONE write transaction, so a generic
 * Coordinator never sees an executable ready task between these operations.
 * Failure rolls back both mutations. This service NEVER starts a model/CLI:
 * the next native sender must separately prove the same process/sandbox and
 * handle an unobserved prompt without blindly resending it.
 */
export function reserveOneHubWorkerDispatch(
  db: OrchestrationDb,
  host: HubWorkerDispatchHost,
  nowMs: number = Date.now()
): HubReservedNativeDispatch {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Invalid host clock')
  }
  const target = host.readCurrentTarget()
  if (!target) { throw new Error('Host no longer owns this task/worktree') }
  validateTarget(target)
  // Check sandbox and pane identity BEFORE modifying the user's SQLite DB.
  requireVerifiedAgentSandbox(host.sandbox, {
    hostId: target.hostId, repoId: target.repoId,
    worktreeId: target.worktreeId, baseSha: target.baseSha
  })
  const terminal = host.readVerifiedTerminal(target)
  validateTerminal(terminal)

  const ledger = new HostAdmissionLedger(db)
  db.db.exec(SQL)
  db.db.exec('BEGIN IMMEDIATE')
  try {
    // A fresh host snapshot is required while the writer lock is held.
    const current = host.readCurrentTarget()
    if (!current || JSON.stringify(current) !== JSON.stringify(target)) {
      throw new Error('Host identity drift before Dispatch transaction')
    }
    requireVerifiedAgentSandbox(host.sandbox, {
      hostId: target.hostId, repoId: target.repoId,
      worktreeId: target.worktreeId, baseSha: target.baseSha
    })
    const currentTerminal = host.readVerifiedTerminal(target)
    if (!currentTerminal ||
        JSON.stringify(currentTerminal) !== JSON.stringify(terminal)) {
      throw new Error('Host terminal changed before Dispatch transaction')
    }

    const admitted = ledger.getReservation(target.permitRequestId)
    if (!admitted || admitted.state !== 'completed' ||
        admitted.operation !== 'agent_turn' || !admitted.receipt) {
      throw new Error('No completed single-turn execution permit')
    }
    const grant = db.db.prepare(
      'SELECT scope_json,revoked FROM adaptive_scope_grants WHERE id=?'
    ).get(admitted.scope_id) as { scope_json: string; revoked: number } | undefined
    if (!grant || grant.revoked !== 0) {
      throw new Error('Worker execution scope revoked or missing')
    }
    const scope: unknown = JSON.parse(grant.scope_json)
    assertAdaptiveScope(scope)
    if (scope.operations.length !== 1 || scope.operations[0] !== 'agent_turn' ||
        scope.maxOperations !== 1 || scope.allowedTaskIds.length !== 1 ||
        scope.allowedTaskIds[0] !== target.hubTaskId ||
        nowMs >= Date.parse(scope.expiresAt)) {
      throw new Error('Scope does not permit this exact single worker turn')
    }
    for (const key of [
      'projectId', 'repoId', 'hostId', 'baseSha', 'planId', 'planSha'
    ] as const) {
      if (scope[key] !== target[key]) {
        throw new Error('Worker execution scope identity mismatch')
      }
    }
    const permit = db.db.prepare(
      'SELECT request_id,decision_id,run_id,task_id,worktree_id,base_sha,status ' +
      'FROM adaptive_execution_permits WHERE request_id=?'
    ).get(target.permitRequestId) as PermitRow | undefined
    if (!permit || permit.status !== 'prepared' ||
        permit.run_id !== target.nativeRunId ||
        permit.task_id !== target.nativeTaskId ||
        permit.worktree_id !== target.worktreeId ||
        permit.base_sha !== target.baseSha) {
      throw new Error('Prepared host execution permit does not match native task')
    }
    const originalReceipt: unknown = JSON.parse(admitted.receipt)
    if (!originalReceipt || typeof originalReceipt !== 'object' ||
        !('requestId' in originalReceipt) ||
        originalReceipt.requestId !== target.permitRequestId ||
        !('state' in originalReceipt) || originalReceipt.state !== 'prepared' ||
        !('runId' in originalReceipt) || originalReceipt.runId !== target.nativeRunId ||
        !('taskId' in originalReceipt) || originalReceipt.taskId !== target.nativeTaskId ||
        !('decisionId' in originalReceipt) ||
        originalReceipt.decisionId !== permit.decision_id) {
      throw new Error('Prepared execution receipt is invalid or divergent')
    }
    const identity = JSON.stringify({ target, terminal })
    const old = db.db.prepare(
      'SELECT identity_json,receipt_json FROM adaptive_worker_dispatch_claims WHERE permit_request_id=?'
    ).get(target.permitRequestId) as ClaimRow | undefined
    if (old) {
      if (old.identity_json !== identity) {
        throw new Error('Dispatch replay identity mismatch')
      }
      const receipt: HubReservedNativeDispatch = JSON.parse(old.receipt_json)
      if (db.getDispatchContextById(receipt.dispatchId)?.task_id !== target.nativeTaskId) {
        throw new Error('Dispatch replay evidence missing or divergent')
      }
      db.db.exec('COMMIT')
      return receipt
    }

    const task = db.getTask(target.nativeTaskId)
    if (!task || task.run_id !== target.nativeRunId ||
        task.status !== 'ready' || !isAdaptiveStagedTaskSpec(task.spec) ||
        db.getDispatchContext(task.id)) {
      throw new Error('Staged native Task is not ready for first Dispatch')
    }
    const deps: unknown = JSON.parse(task.deps)
    if (!Array.isArray(deps) ||
        deps.some(id => typeof id !== 'string' || db.getTask(id)?.status !== 'completed')) {
      throw new Error('Dependencies have not completed')
    }
    const raw: unknown = JSON.parse(task.spec)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        !('source' in raw) || raw.source !== 'adaptive-untrusted-plan') {
      throw new Error('Invalid staged Task spec')
    }
    const promoted = JSON.stringify({
      ...raw, source: 'adaptive-supervised-native-worker',
      permitRequestId: target.permitRequestId
    })
    const updated = db.db.prepare(
      "UPDATE tasks SET spec=? WHERE id=? AND run_id=? AND status='ready' AND spec=?"
    ).run(promoted, task.id, target.nativeRunId, task.spec)
    if (updated.changes !== 1) {
      throw new Error('Task changed during atomic Dispatch claim')
    }
    const dispatch = db.createDispatchContext({
      taskId: task.id, assigneeHandle: terminal.handle,
      assigneePaneKey: terminal.paneKey,
      launchTokenHash: terminal.launchTokenHash,
      processIncarnation: terminal.processIncarnation,
      creator: { kind: 'system' }, maxDepth: 1
    })
    const receipt: HubReservedNativeDispatch = {
      permitRequestId: target.permitRequestId,
      runId: target.nativeRunId, taskId: task.id,
      dispatchId: dispatch.id, assigneeHandle: terminal.handle,
      workerStarted: false, modelCalls: 0, state: 'dispatch_reserved'
    }
    db.db.prepare(
      'INSERT INTO adaptive_worker_dispatch_claims ' +
      '(permit_request_id,run_id,task_id,dispatch_id,scope_id,assignee_handle,identity_json,receipt_json) ' +
      'VALUES (?,?,?,?,?,?,?,?)'
    ).run(target.permitRequestId,target.nativeRunId,task.id,dispatch.id,
      admitted.scope_id,terminal.handle,identity,JSON.stringify(receipt))
    db.db.exec('COMMIT')
    return receipt
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
}
