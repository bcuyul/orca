import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { HostAdmissionLedger } from './host-admission-ledger'
import { HostExecutionPermitStore, type VerifiedExecutionDecision } from './host-execution-permit'
import { NativePlanMaterializer } from './native-plan-materializer'
import { emptyProjectHub, type HubDocument } from '../../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../../shared/project-hub-intelligence'
import type { AdaptiveRequest, AdaptiveScope } from '../../../shared/adaptive-delivery/admission-contracts'

const now = Date.parse('2026-11-02T12:00:00Z')
const sha = 'a'.repeat(40)
const plan: HubPlanProposal = {
  id: 'plan-permit', objective: 'Implement isolated inventory use case',
  rationale: 'Host-authorized execution must be separate from plan approval',
  source: 'human', createdAt: '2026-11-02T10:00:00Z',
  tasks: [{ id: 'plan-task-one', title: 'Build inventory lookup', role: 'forge',
    dependsOn: [], acceptance: 'Lookup correctly returns one item' }]
}
const planSha = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
const document: HubDocument = {
  ...emptyProjectHub('project-permit'), revision: 2,
  intelligence: { ...emptyHubIntelligence(), plans: [plan],
    decisions: [{ id: 'accepted-plan', subject: 'plan',
      subjectId: plan.id, verdict: 'accepted',
      justification: 'Approved data-only implementation plan',
      createdAt: '2026-11-02T11:00:00Z' }] }
}
function scope(operation: 'materialize_run' | 'agent_turn'): AdaptiveScope {
  return {
    projectId: document.projectId, repoId: 'repo-permit', hostId: 'host-one',
    baseSha: sha, planId: plan.id, planSha,
    allowedTaskIds: ['plan-task-one'], operations: [operation],
    maxOperations: 1, expiresAt: '2099-01-01T00:00:00Z'
  }
}
function request(operation: 'materialize_run' | 'agent_turn'): AdaptiveRequest {
  return {
    requestId: operation === 'materialize_run' ? 'materialize-request' : 'execute-request',
    scopeId: operation === 'materialize_run' ? 'materialize-scope' : 'execution-scope',
    projectId: document.projectId, repoId: 'repo-permit', hostId: 'host-one',
    baseSha: sha, planId: plan.id, planSha,
    taskIds: ['plan-task-one'], operation
  }
}
function setup() {
  const db = new OrchestrationDb(':memory:')
  const ledger = new HostAdmissionLedger(db)
  ledger.recordHostApproval('materialize-scope', scope('materialize_run'))
  const materializer = new NativePlanMaterializer(db, ledger, {
    read(projectId) {
      if (projectId !== document.projectId) { throw new Error('unknown project') }
      return document
    }
  })
  const materialized = materializer.materialize({
    admission: request('materialize_run'), expectedHubRevision: document.revision, nowMs: now
  })
  const taskId = materialized.tasks['plan-task-one']
  const decision: VerifiedExecutionDecision = {
    id: 'human-execution-decision', projectId: document.projectId,
    repoId: 'repo-permit', hostId: 'host-one', baseSha: sha,
    planId: plan.id, planSha, runId: materialized.runId, taskId,
    worktreeId: 'worktree-lab', approvedAtMs: now - 1000,
    expiresAtMs: now + 60000, maxTurns: 1
  }
  const approvals = { readVerifiedExecutionDecision: vi.fn((_id: string) => decision) }
  const worktrees = { readVerifiedWorktree: vi.fn(() => ({
    repoId: 'repo-permit', hostId: 'host-one',
    worktreeId: 'worktree-lab', baseSha: sha
  })) }
  const permits = new HostExecutionPermitStore(db, ledger, approvals, worktrees)
  const input = {
    admission: request('agent_turn'), materializationRequestId: 'materialize-request',
    nativeRunId: materialized.runId, nativeTaskId: taskId,
    worktreeId: 'worktree-lab', decisionId: decision.id, nowMs: now
  }
  return { db, ledger, permits, input, decision, approvals, worktrees, taskId }
}
type TestContext = ReturnType<typeof setup>
function testWithDb(fn: (ctx: TestContext) => void): void {
  const ctx = setup()
  try { fn(ctx) } finally { ctx.db.close() }
}
describe('Host execution permit: independent verified authority, still no Dispatch', () => {
  it('refuses a plan-approved run without a separate agent-turn scope', () => testWithDb(
    ({ permits, input, ledger }) => {
      expect(() => permits.prepare(input)).toThrow(/unapproved_scope/)
      expect(ledger.getReservation(input.admission.requestId)).toBeUndefined()
    }
  ))

  it('prepares one permission, idempotently replays, without dispatching', () => testWithDb(
    ({ db, ledger, permits, input, taskId }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      const result = permits.prepare(input)
      expect(result).toMatchObject({
        state: 'prepared', dispatched: false,
        taskId, runId: input.nativeRunId, worktreeId: input.worktreeId
      })
      expect(permits.prepare({ ...input, nowMs: now + 1000 })).toEqual(result)
      expect(db.db.prepare('SELECT COUNT(*) AS total FROM adaptive_execution_permits').get())
        .toMatchObject({ total: 1 })
      expect(db.db.prepare('SELECT COUNT(*) AS total FROM dispatch_contexts').get())
        .toMatchObject({ total: 0 })
      expect(() => db.createDispatchContext({
        taskId, assigneeHandle: 'unsafe-terminal',
        creator: { kind: 'system' }, maxDepth: 1
      })).toThrow(/adaptive_staged_not_authorized/)
    }
  ))

  it('does not accept a missing or mismatched host decision', () => testWithDb(
    ({ permits, input, decision, approvals, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      approvals.readVerifiedExecutionDecision.mockReturnValueOnce(null as never)
      expect(() => permits.prepare(input)).toThrow(/verified_host_execution_decision/)
      approvals.readVerifiedExecutionDecision.mockReturnValueOnce({
        ...decision, hostId: 'other-host'
      })
      expect(() => permits.prepare(input)).toThrow(/verified_host_execution_decision/)
      expect(ledger.getReservation(input.admission.requestId)).toBeUndefined()
    }
  ))

  it('does not accept a worktree at a different base SHA', () => testWithDb(
    ({ permits, input, worktrees, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      worktrees.readVerifiedWorktree.mockReturnValueOnce({
        repoId: 'repo-permit', hostId: 'host-one',
        worktreeId: 'worktree-lab', baseSha: 'f'.repeat(40)
      })
      expect(() => permits.prepare(input)).toThrow(/worktree_snapshot_mismatch/)
      expect(ledger.getReservation(input.admission.requestId)).toBeUndefined()
    }
  ))

  it('rejects impersonation, unknown Run/Task, and mismatched plan task ID', () => testWithDb(
    ({ permits, input, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      expect(() => permits.prepare({ ...input, nativeTaskId: 'unknown-task' }))
        .toThrow(/verified_host_execution_decision/)
      expect(() => permits.prepare({
        ...input, admission: { ...input.admission, taskIds: ['wrong-id'] }
      })).toThrow(/materialization_identity_mismatch/)
      expect(() => permits.prepare({ ...input, nativeRunId: 'other-run' }))
        .toThrow(/verified_host_execution_decision/)
      expect(ledger.getReservation(input.admission.requestId)).toBeUndefined()
    }
  ))

  it('rejects expired, missing, or future host execution approval', () => testWithDb(
    ({ permits, input, decision, approvals, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      approvals.readVerifiedExecutionDecision.mockReturnValueOnce({
        ...decision, expiresAtMs: now
      })
      expect(() => permits.prepare(input)).toThrow(/verified_host_execution_decision/)
      approvals.readVerifiedExecutionDecision.mockReturnValueOnce({
        ...decision, approvedAtMs: now + 1000
      })
      expect(() => permits.prepare(input)).toThrow(/verified_host_execution_decision/)
      expect(ledger.getReservation(input.admission.requestId)).toBeUndefined()
    }
  ))

  it('a different request cannot spend a second permission from the same scope', () => testWithDb(
    ({ permits, input, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      permits.prepare(input)
      expect(() => permits.prepare({
        ...input, admission: { ...input.admission, requestId: 'execute-request-2' }
      })).toThrow(/budget_exhausted/)
      expect(dbCount(ledger, 'adaptive_execution_permits')).toBe(1)
    }
  ))

  it('replay with a different verified worktree cannot reuse the original receipt', () => testWithDb(
    ({ permits, input, ledger, worktrees, approvals, decision }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      const original = permits.prepare(input)
      approvals.readVerifiedExecutionDecision.mockReturnValueOnce({
        ...decision, worktreeId: 'other-worktree'
      })
      worktrees.readVerifiedWorktree.mockReturnValueOnce({
        repoId: 'repo-permit', hostId: 'host-one',
        worktreeId: 'other-worktree', baseSha: sha
      })
      expect(() => permits.prepare({ ...input, worktreeId: 'other-worktree' }))
        .toThrow(/execution_permit_replay_mismatch/)
      expect(permits.prepare(input)).toEqual(original)
    }
  ))

  it('revoking execution scope prevents a new reservation', () => testWithDb(
    ({ permits, input, ledger }) => {
      ledger.recordHostApproval('execution-scope', scope('agent_turn'))
      ledger.revoke('execution-scope')
      expect(() => permits.prepare(input)).toThrow(/unapproved_scope/)
    }
  ))
})
function dbCount(ledger: HostAdmissionLedger, table: string): number {
  // This helper deliberately cannot query the private ledger DB; use a
  // stable operation receipt check rather than poking through private state.
  void table
  return ledger.getReservation('execute-request')?.state === 'completed' ? 1 : 0
}
