import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import { HostExecutionPermitStore, type VerifiedExecutionDecision } from '../runtime/adaptive-delivery/host-execution-permit'
import type { AgentSandboxEvidence } from '../runtime/adaptive-delivery/execution-sandbox-policy'
import type { AdaptiveScope, AdaptiveRequest } from '../../shared/adaptive-delivery/admission-contracts'
import { emptyProjectHub } from '../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../shared/project-hub-intelligence'
import { buildNativePlanPreview } from './native-plan-preview'
import { stageHubNativePlan } from './supervised-native-plan-stage'
import { hubStageAdmission } from './native-stage-identity'
import {
  reserveOneHubWorkerDispatch, type VerifiedHubWorkerDispatchTarget
} from './host-worker-atomic-dispatch'

const opened: OrchestrationDb[] = []
afterEach(() => { for (const db of opened.splice(0)) { db.close() } })
const sha = 'a'.repeat(40)
const plan: HubPlanProposal = {
  id: 'plan-atomic', source: 'human',
  objective: 'Run one native worker safely in an isolated lab',
  rationale: 'Verify atomic permit consumption and Dispatch reservation without CLI',
  createdAt: '2026-11-10T12:00:00Z',
  tasks: [
    { id: 'forge', role: 'forge', title: 'Build feature',
      acceptance: 'Relevant Vitest passes', dependsOn: [] },
    { id: 'qa', role: 'qa', title: 'Review feature',
      acceptance: 'Independent QA', dependsOn: ['forge'] }
  ]
}
async function makeLab() {
  const projectId = 'repo:atomic-lab'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan],
      decisions: [{
        id: 'plan-approved', subject: 'plan' as const, subjectId: plan.id,
        verdict: 'accepted' as const, justification: 'Reviewed isolated test plan',
        createdAt: '2026-11-10T12:05:00Z'
      }]
    }
  }
  const db = new OrchestrationDb(':memory:')
  opened.push(db)
  const worktree = {
    projectId, repoId: 'repo-atomic', hostId: 'local',
    worktreeId: 'worktree-atomic', baseSha: sha
  }
  const preview = buildNativePlanPreview(doc, plan.id, 2)
  const stageArgs = {
    projectId, planId: plan.id, expectedRevision: 2,
    planSha: preview.planSha, worktreeId: worktree.worktreeId
  }
  const stage = await stageHubNativePlan(stageArgs, {
    readProject: () => doc,
    inspectWorktree: async () => ({ ...worktree }),
    confirmInHostWindow: async () => true,
    getOrchestrationDb: () => db
  })
  if (stage.status !== 'staged') { throw new Error('Lab staging denied') }
  const materialization = hubStageAdmission({
    ...worktree, planId: plan.id, planSha: preview.planSha,
    taskIds: plan.tasks.map(t => t.id)
  })
  const ledger = new HostAdmissionLedger(db)
  const scope: AdaptiveScope = {
    projectId, repoId: worktree.repoId, hostId: worktree.hostId,
    baseSha: sha, planId: plan.id, planSha: preview.planSha,
    allowedTaskIds: ['forge'], operations: ['agent_turn'],
    maxOperations: 1, expiresAt: '2099-01-01T00:00:00Z'
  }
  const admission: AdaptiveRequest = {
    requestId: 'one-turn-atomic', scopeId: 'one-turn-scope',
    projectId, repoId: worktree.repoId, hostId: worktree.hostId,
    baseSha: sha, planId: plan.id, planSha: preview.planSha,
    taskIds: ['forge'], operation: 'agent_turn'
  }
  ledger.recordHostApproval(admission.scopeId, scope)
  const taskId = stage.tasks.forge!
  const nowMs = Date.now()
  const decision: VerifiedExecutionDecision = {
    id: 'one-turn-decision', projectId, repoId: worktree.repoId,
    hostId: worktree.hostId, baseSha: sha,
    planId: plan.id, planSha: preview.planSha, runId: stage.runId,
    taskId, worktreeId: worktree.worktreeId,
    approvedAtMs: nowMs - 500, expiresAtMs: nowMs + 60_000,
    maxTurns: 1
  }
  const sandbox = {
    inspectSandbox: vi.fn((): AgentSandboxEvidence => ({
      kind: 'os-enforced', sandboxId: 'fake-os-sandbox',
      filesystem: 'restricted', network: 'restricted',
      childProcesses: 'confined', policyDigest: 'b'.repeat(64)
    }))
  }
  const permits = new HostExecutionPermitStore(db, ledger,
    { readVerifiedExecutionDecision: () => decision },
    { readVerifiedWorktree: () => ({
      repoId: worktree.repoId, hostId: worktree.hostId,
      worktreeId: worktree.worktreeId, baseSha: sha
    }) }, sandbox)
  permits.prepare({
    admission, materializationRequestId: materialization.requestId,
    nativeRunId: stage.runId, nativeTaskId: taskId,
    worktreeId: worktree.worktreeId,
    decisionId: decision.id, nowMs
  })
  const target: VerifiedHubWorkerDispatchTarget = {
    ...worktree, planId: plan.id, planSha: preview.planSha,
    hubTaskId: 'forge', nativeRunId: stage.runId,
    nativeTaskId: taskId, permitRequestId: admission.requestId
  }
  const terminal = {
    handle: 'fake-worker-one', paneKey: 'fake-pane-one',
    processIncarnation: 'fake-process-one', launchTokenHash: 'c'.repeat(64)
  }
  const readCurrentTarget = vi.fn(() => ({ ...target }))
  const readVerifiedTerminal = vi.fn(() => ({ ...terminal }))
  return {
    db, ledger, scope, admission, stage, taskId, target,
    sandbox, readCurrentTarget, readVerifiedTerminal, terminal,
    host: { sandbox, readCurrentTarget, readVerifiedTerminal }
  }
}
function count(db: OrchestrationDb, table: string): number {
  return (db.db.prepare(`SELECT COUNT(*) as total FROM ${table}`).get() as
    { total: number }).total
}

describe('Atomic host-one-worker Dispatch, no model launch', () => {
  it('promotes staged Task, creates exactly one Dispatch and receipt atomically', async () => {
    const h = await makeLab()
    expect(() => h.db.createDispatchContext({
      taskId: h.taskId, assigneeHandle: h.terminal.handle,
      creator: { kind: 'system' }, maxDepth: 1
    })).toThrow(/adaptive_staged_not_authorized/)
    const first = reserveOneHubWorkerDispatch(h.db, h.host)
    expect(first).toMatchObject({
      permitRequestId: h.admission.requestId, runId: h.stage.runId,
      taskId: h.taskId, state: 'dispatch_reserved',
      workerStarted: false, modelCalls: 0
    })
    expect(h.db.getTask(h.taskId)?.status).toBe('dispatched')
    expect(JSON.parse(h.db.getTask(h.taskId)!.spec)).toMatchObject({
      source: 'adaptive-supervised-native-worker',
      permitRequestId: h.admission.requestId
    })
    expect(h.db.getTask(h.stage.tasks.qa!)?.status).toBe('pending')
    expect(count(h.db, 'dispatch_contexts')).toBe(1)
    expect(count(h.db, 'adaptive_worker_dispatch_claims')).toBe(1)
    expect(reserveOneHubWorkerDispatch(h.db, h.host)).toEqual(first)
    expect(count(h.db, 'dispatch_contexts')).toBe(1)
  })

  it('refuses a worktree-only sandbox before a single effect', async () => {
    const h = await makeLab()
    h.sandbox.inspectSandbox.mockReturnValue({ kind: 'worktree-only' })
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/execution_sandbox_required/)
    expect(h.db.getTask(h.taskId)?.status).toBe('ready')
    expect(count(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('refuses an unauthenticated terminal and does not promote spec', async () => {
    const h = await makeLab()
    h.readVerifiedTerminal.mockReturnValue(null as never)
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/Authenticated host terminal/)
    expect(h.db.getTask(h.taskId)?.status).toBe('ready')
    expect(count(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('does not dispatch after execution grant is revoked', async () => {
    const h = await makeLab()
    h.ledger.revoke(h.admission.scopeId)
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/revoked or missing/)
    expect(count(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('detects host Git drift at the transactional boundary', async () => {
    const h = await makeLab()
    h.readCurrentTarget.mockReturnValueOnce({ ...h.target })
      .mockReturnValueOnce({ ...h.target, baseSha: 'f'.repeat(40) })
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/identity drift/)
    expect(h.db.getTask(h.taskId)?.status).toBe('ready')
    expect(count(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('rolls back Task promotion when terminal is already busy', async () => {
    const h = await makeLab()
    const otherRun = h.db.createRun({
      objective: 'Unrelated live work',
      coordinatorHandle: null, coordinatorPaneKey: null
    })
    const otherTask = h.db.createTask({
      runId: otherRun.id, spec: 'Unrelated task outside Project Hub'
    })
    h.db.createDispatchContext({
      taskId: otherTask.id, assigneeHandle: h.terminal.handle,
      assigneePaneKey: h.terminal.paneKey,
      creator: { kind: 'system' }, maxDepth: 1
    })
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/already has an active dispatch/)
    expect(h.db.getTask(h.taskId)?.status).toBe('ready')
    expect(JSON.parse(h.db.getTask(h.taskId)!.spec).source)
      .toBe('adaptive-untrusted-plan')
    expect(count(h.db, 'adaptive_worker_dispatch_claims')).toBe(0)
    expect(count(h.db, 'dispatch_contexts')).toBe(1)
  })

  it('will not let a changed verified terminal replay an earlier Dispatch', async () => {
    const h = await makeLab()
    reserveOneHubWorkerDispatch(h.db, h.host)
    h.readVerifiedTerminal.mockReturnValue({
      ...h.terminal, processIncarnation: 'other-process'
    })
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host))
      .toThrow(/replay identity mismatch/)
    expect(count(h.db, 'dispatch_contexts')).toBe(1)
  })

  it('rejects expired scope without changing a Task or Dispatch', async () => {
    const h = await makeLab()
    const afterExpiry = Date.parse('2100-01-01T00:00:00Z')
    expect(() => reserveOneHubWorkerDispatch(h.db, h.host, afterExpiry))
      .toThrow(/Scope does not permit/)
    expect(count(h.db, 'dispatch_contexts')).toBe(0)
  })
})
