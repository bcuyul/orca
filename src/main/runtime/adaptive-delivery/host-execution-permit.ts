import { createHash } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { AdaptiveRequest } from '../../../shared/adaptive-delivery/admission-contracts'
import { assertAdaptiveRequest } from '../../../shared/adaptive-delivery/admission-contracts'
import { isAdaptiveStagedTaskSpec } from '../orchestration/adaptive-staged-task'
import type { HostAdmissionLedger } from './host-admission-ledger'
import type { NativeMaterialization } from './native-plan-materializer'

/**
 * A decision verified and read from a TRUSTED host component, not from the
 * renderer, an agent prompt, a Project Hub plan acceptance or an RPC payload.
 * The real host-authenticated consent source remains a separate integration.
 */
export type VerifiedExecutionDecision = {
  id: string
  projectId: string
  repoId: string
  hostId: string
  baseSha: string
  planSha: string
  planId: string
  runId: string
  taskId: string
  worktreeId: string
  approvedAtMs: number
  expiresAtMs: number
  maxTurns: 1
}
export type VerifiedHostDecisionReader = {
  readVerifiedExecutionDecision(id: string): VerifiedExecutionDecision | null
}
export type VerifiedWorktreeReader = {
  readVerifiedWorktree(params: {
    repoId: string
    hostId: string
    worktreeId: string
  }): { repoId: string; hostId: string; worktreeId: string; baseSha: string } | null
}
export type ExecutionPermitRequest = {
  admission: AdaptiveRequest
  materializationRequestId: string
  nativeRunId: string
  nativeTaskId: string
  worktreeId: string
  decisionId: string
  nowMs: number
}
export type PreparedExecutionPermit = {
  requestId: string
  runId: string
  taskId: string
  decisionId: string
  worktreeId: string
  /** This result is NOT authority to invoke a CLI or send a prompt. */
  dispatched: false
  state: 'prepared'
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{0,199}$/
const SQL = `CREATE TABLE IF NOT EXISTS adaptive_execution_permits (
  request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL UNIQUE,
  decision_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE,
  worktree_id TEXT NOT NULL, base_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status = 'prepared')
)`

/**
 * Host-only launch admission: independent human decision + current worktree
 * identity + materialized plan provenance + scoped operation budget.
 * Never flips the staged-task dispatch fence; prepared != executed.
 */
export class HostExecutionPermitStore {
  constructor(
    private readonly db: OrchestrationDb,
    private readonly ledger: HostAdmissionLedger,
    private readonly decisions: VerifiedHostDecisionReader,
    private readonly worktrees: VerifiedWorktreeReader
  ) {
    db.db.exec(SQL)
  }

  prepare(input: ExecutionPermitRequest): PreparedExecutionPermit {
    const req = input.admission
    assertAdaptiveRequest(req)
    if (req.operation !== 'agent_turn' || req.taskIds.length !== 1 ||
        req.taskIds[0] !== input.nativeTaskId) {
      throw new Error('one explicitly selected native Task is required')
    }
    if (![input.materializationRequestId, input.nativeRunId, input.nativeTaskId,
      input.worktreeId, input.decisionId].every(s => SAFE_ID.test(s))) {
      throw new Error('invalid execution identity')
    }
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      throw new Error('invalid execution clock')
    }

    // Read verified facts from the host, never accept a renderer-provided "approved" boolean.
    const verified = this.decisions.readVerifiedExecutionDecision(input.decisionId)
    if (!verified || verified.id !== input.decisionId ||
        verified.projectId !== req.projectId || verified.repoId !== req.repoId ||
        verified.hostId !== req.hostId || verified.baseSha !== req.baseSha ||
        verified.planId !== req.planId || verified.planSha !== req.planSha ||
        verified.runId !== input.nativeRunId || verified.taskId !== input.nativeTaskId ||
        verified.worktreeId !== input.worktreeId || verified.maxTurns !== 1 ||
        !Number.isSafeInteger(verified.approvedAtMs) ||
        !Number.isSafeInteger(verified.expiresAtMs) ||
        verified.approvedAtMs > input.nowMs || verified.expiresAtMs <= input.nowMs) {
      throw new Error('verified_host_execution_decision_missing_or_mismatched')
    }
    const snapshot = this.worktrees.readVerifiedWorktree({
      repoId: req.repoId, hostId: req.hostId, worktreeId: input.worktreeId
    })
    if (!snapshot || snapshot.repoId !== req.repoId || snapshot.hostId !== req.hostId ||
        snapshot.worktreeId !== input.worktreeId || snapshot.baseSha !== req.baseSha) {
      throw new Error('worktree_snapshot_mismatch')
    }
    const original = this.ledger.getReservation(input.materializationRequestId)
    if (!original || original.operation !== 'materialize_run' ||
        original.state !== 'completed' || !original.receipt) {
      throw new Error('materialization_not_completed')
    }
    let materialized: NativeMaterialization
    try { materialized = JSON.parse(original.receipt) as NativeMaterialization } catch {
      throw new Error('materialization_receipt_invalid')
    }
    const identity = materialized?.provenance
    if (materialized.runId !== input.nativeRunId || materialized.planId !== req.planId ||
        materialized.tasks?.[req.taskIds[0]] !== input.nativeTaskId ||
        identity?.projectId !== req.projectId || identity.repoId !== req.repoId ||
        identity.hostId !== req.hostId || identity.baseSha !== req.baseSha ||
        identity.planSha !== req.planSha) {
      throw new Error('materialization_identity_mismatch')
    }
    const task = this.db.getTask(input.nativeTaskId)
    if (task?.run_id !== input.nativeRunId || task.status !== 'ready' ||
        !isAdaptiveStagedTaskSpec(task.spec) ||
        !this.db.getRun(input.nativeRunId) ||
        this.db.getDispatchContext(input.nativeTaskId)) {
      throw new Error('native_task_not_staged_and_ready')
    }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const prior = this.ledger.reserve(req, input.nowMs)
    if (prior.disposition === 'completed') {
      const stored = this.db.db.prepare(
        'SELECT input_hash FROM adaptive_execution_permits WHERE request_id = ?'
      ).get(req.requestId) as { input_hash: string } | undefined
      if (!stored || stored.input_hash !== hash || !prior.receipt) {
        throw new Error('execution_permit_replay_mismatch')
      }
      return JSON.parse(prior.receipt) as PreparedExecutionPermit
    }
    if (prior.disposition !== 'new') {
      throw new Error('execution_permit_uncertain_or_pending')
    }
    const prepared: PreparedExecutionPermit = {
      requestId: req.requestId, runId: input.nativeRunId, taskId: input.nativeTaskId,
      decisionId: input.decisionId, worktreeId: input.worktreeId,
      dispatched: false, state: 'prepared'
    }
    // Reservation exists; a failed write is unknown, not a second launch.
    this.db.db.exec('SAVEPOINT adaptive_execution_permit')
    try {
      this.db.db.prepare(
        'INSERT INTO adaptive_execution_permits (request_id,input_hash,decision_id,run_id,task_id,worktree_id,base_sha) VALUES (?,?,?,?,?,?,?)'
      ).run(req.requestId, hash, input.decisionId, input.nativeRunId,
        input.nativeTaskId, input.worktreeId, req.baseSha)
      this.ledger.complete(req.requestId, JSON.stringify(prepared))
      this.db.db.exec('RELEASE adaptive_execution_permit')
      return prepared
    } catch (error) {
      this.db.db.exec('ROLLBACK TO adaptive_execution_permit')
      this.db.db.exec('RELEASE adaptive_execution_permit')
      if (this.ledger.getReservation(req.requestId)?.state === 'reserved') {
        this.ledger.markUnknown(req.requestId)
      }
      throw error
    }
  }
}
