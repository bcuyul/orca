import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import {
  HostExecutionPermitStore, type VerifiedExecutionDecision
} from '../runtime/adaptive-delivery/host-execution-permit'
import type {
  AdaptiveScope, AdaptiveRequest
} from '../../shared/adaptive-delivery/admission-contracts'
import type {
  AgentSandboxEvidence
} from '../runtime/adaptive-delivery/execution-sandbox-policy'
import { emptyProjectHub } from '../../shared/project-hub-types'
import {
  emptyHubIntelligence, type HubPlanProposal
} from '../../shared/project-hub-intelligence'
import { buildNativePlanPreview } from './native-plan-preview'
import { stageHubNativePlan } from './supervised-native-plan-stage'
import { hubStageAdmission } from './native-stage-identity'
import { reserveOneHubWorkerDispatch } from './host-worker-atomic-dispatch'
import { inspectHubWorkerDispatches } from './host-worker-dispatch-recovery'

const opened: OrchestrationDb[] = []
afterEach(() => { for (const db of opened.splice(0)) { db.close() } })
const baseSha = 'a'.repeat(40)
const plan: HubPlanProposal = {
  id: 'plan-recovery', source: 'human',
  objective: 'Recover one supervised dispatch without a second model call',
  rationale: 'Native read-only crash recovery and no blind retry',
  createdAt: '2026-11-11T09:00:00Z',
  tasks: [
    { id: 'forge', title: 'Implement', role: 'forge',
      acceptance: 'Relevant tests pass', dependsOn: [] },
    { id: 'qa', title: 'Independent QA', role: 'qa',
      acceptance: 'Review actual evidence', dependsOn: ['forge'] }
  ]
}
async function harness() {
  const projectId = 'repo:recovery-lab'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan], decisions: [{
        id: 'approved-plan', subject: 'plan' as const,
        subjectId: plan.id, verdict: 'accepted' as const,
        justification: 'Reviewed synthetic lab DAG',
        createdAt: '2026-11-11T09:01:00Z'
      }]
    }
  }
  const db = new OrchestrationDb(':memory:')
  opened.push(db)
  const worktree = {
    projectId, repoId: 'repo-recovery',
    hostId: 'local', worktreeId: 'worktree-recovery', baseSha
  }
  const preview = buildNativePlanPreview(doc, plan.id, 2)
  const stage = await stageHubNativePlan({
    projectId, planId: plan.id, expectedRevision: 2,
    planSha: preview.planSha, worktreeId: worktree.worktreeId
  }, {
    readProject: () => doc,
    inspectWorktree: async () => worktree,
    confirmInHostWindow: async () => true,
    getOrchestrationDb: () => db
  })
  if (stage.status !== 'staged') { throw new Error('Synthetic stage failed') }
  const materialization = hubStageAdmission({
    ...worktree, planId: plan.id, planSha: preview.planSha,
    taskIds: plan.tasks.map(t => t.id)
  })
  const ledger = new HostAdmissionLedger(db)
  const scope: AdaptiveScope = {
    projectId, repoId: worktree.repoId, hostId: worktree.hostId,
    baseSha, planId: plan.id, planSha: preview.planSha,
    allowedTaskIds: ['forge'], operations: ['agent_turn'],
    maxOperations: 1, expiresAt: '2099-01-01T00:00:00Z'
  }
  const admission: AdaptiveRequest = {
    requestId: 'recovery-permit', scopeId: 'recovery-grant',
    projectId, repoId: worktree.repoId, hostId: worktree.hostId,
    baseSha, planId: plan.id, planSha: preview.planSha,
    taskIds: ['forge'], operation: 'agent_turn'
  }
  ledger.recordHostApproval(admission.scopeId, scope)
  const taskId = stage.tasks.forge!
  const now = Date.now()
  const decision: VerifiedExecutionDecision = {
    id: 'recovery-decision', projectId, repoId: worktree.repoId,
    hostId: worktree.hostId, baseSha, planId: plan.id,
    planSha: preview.planSha, runId: stage.runId,
    taskId, worktreeId: worktree.worktreeId,
    approvedAtMs: now - 500, expiresAtMs: now + 60_000,
    maxTurns: 1
  }
  // Test-only sandbox authority. No real OS sandbox or CLI exists here.
  const sandbox = {
    inspectSandbox: vi.fn((): AgentSandboxEvidence => ({
      kind: 'os-enforced', sandboxId: 'synthetic-recovery-sandbox',
      filesystem: 'restricted', network: 'restricted',
      childProcesses: 'confined', policyDigest: 'b'.repeat(64)
    }))
  }
  const permit = new HostExecutionPermitStore(db, ledger,
    { readVerifiedExecutionDecision: () => decision },
    { readVerifiedWorktree: () => ({
      repoId: worktree.repoId, hostId: worktree.hostId,
      worktreeId: worktree.worktreeId, baseSha
    }) }, sandbox)
  permit.prepare({
    admission, materializationRequestId: materialization.requestId,
    nativeRunId: stage.runId, nativeTaskId: taskId,
    worktreeId: worktree.worktreeId, decisionId: decision.id, nowMs: now
  })
  const terminal = {
    handle: 'synthetic-recovery-worker',
    paneKey: 'synthetic-recovery-pane',
    processIncarnation: 'synthetic-recovery-process',
    launchTokenHash: 'c'.repeat(64)
  }
  const target = {
    ...worktree, planId: plan.id, planSha: preview.planSha,
    hubTaskId: 'forge', nativeRunId: stage.runId,
    nativeTaskId: taskId, permitRequestId: admission.requestId
  }
  const claimed = reserveOneHubWorkerDispatch(db, {
    sandbox, readCurrentTarget: () => target,
    readVerifiedTerminal: () => terminal
  })
  const selection = {
    projectId, repoId: worktree.repoId, hostId: worktree.hostId,
    worktreeId: worktree.worktreeId,
    planId: plan.id, planSha: preview.planSha
  }
  return { db, ledger, scope, stage, taskId, admission, claimed, selection }
}
function count(db: OrchestrationDb, table: string): number {
  const row = db.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`)
    .get() as { total: number }
  return row.total
}

describe('read-only host worker Dispatch recovery', () => {
  it('reports a matching reserved Dispatch as UNOBSERVED, never as launched', async () => {
    const h = await harness()
    const before = count(h.db, 'dispatch_contexts')
    const result = inspectHubWorkerDispatches(h.db, h.selection)
    expect(result).toMatchObject({
      status: 'reserved_unobserved', safeToResend: false,
      deliveryVerified: false, executionAuthorized: false,
      entries: [{
        permitRequestId: h.admission.requestId,
        taskId: h.taskId, dispatchId: h.claimed.dispatchId,
        evidence: 'matched', disposition: 'reserved_unobserved',
        taskStatus: 'dispatched'
      }]
    })
    expect(inspectHubWorkerDispatches(h.db, h.selection)).toEqual(result)
    expect(count(h.db, 'dispatch_contexts')).toBe(before)
    expect(h.db.getTask(h.taskId)?.status).toBe('dispatched')
    expect(h.db.getTask(h.stage.tasks.qa!)?.status).toBe('pending')
  })

  it('requires reconciliation when a terminal identity or receipt was modified', async () => {
    const h = await harness()
    h.db.db.prepare(
      'UPDATE dispatch_contexts SET process_incarnation = ? WHERE id = ?'
    ).run('different-process', h.claimed.dispatchId)
    const status = inspectHubWorkerDispatches(h.db, h.selection)
    expect(status.status).toBe('needs_reconciliation')
    expect(status.entries[0]?.evidence).toBe('divergent')
    expect(status.safeToResend).toBe(false)

    const another = await harness()
    another.db.db.prepare(
      'UPDATE adaptive_worker_dispatch_claims SET receipt_json = ? WHERE permit_request_id = ?'
    ).run('{invalid-json', another.admission.requestId)
    expect(inspectHubWorkerDispatches(another.db, another.selection).status)
      .toBe('needs_reconciliation')
  })

  it('classifies native completion as settled but not independently verified QA', async () => {
    const h = await harness()
    h.db.updateTaskStatus(h.taskId, 'completed', 'synthetic-only')
    const recovered = inspectHubWorkerDispatches(h.db, h.selection)
    expect(recovered).toMatchObject({
      status: 'settled_unverified', deliveryVerified: false,
      safeToResend: false,
      entries: [{ disposition: 'settled_unverified', evidence: 'matched' }]
    })
    expect(h.db.getTask(h.stage.tasks.qa!)?.status).toBe('ready')
  })

  it('preserves durable evidence after a scope is revoked', async () => {
    const h = await harness()
    h.ledger.revoke(h.admission.scopeId)
    expect(inspectHubWorkerDispatches(h.db, h.selection)).toMatchObject({
      status: 'needs_reconciliation', safeToResend: false
    })
    expect(count(h.db, 'dispatch_contexts')).toBe(1)
  })

  it('does not disclose Dispatches from another project or worktree', async () => {
    const h = await harness()
    const result = inspectHubWorkerDispatches(h.db, {
      ...h.selection, worktreeId: 'different-worktree'
    })
    expect(result).toEqual({
      status: 'not_found', entries: [], safeToResend: false,
      deliveryVerified: false, executionAuthorized: false
    })
    const other = inspectHubWorkerDispatches(h.db, {
      ...h.selection, projectId: 'repo:other'
    })
    expect(other.entries).toHaveLength(0)
    expect(other.safeToResend).toBe(false)
  })

  it('does not create any ledger table or grant when no claims exist', () => {
    const db = new OrchestrationDb(':memory:')
    opened.push(db)
    const status = inspectHubWorkerDispatches(db, {
      projectId: 'repo:new', repoId: 'repo-new', hostId: 'local',
      worktreeId: 'worktree-new', planId: 'plan-new',
      planSha: 'd'.repeat(64)
    })
    expect(status.status).toBe('not_found')
    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'adaptive_%'"
    ).all() as { name: string }[]
    expect(tables).toEqual([])
  })

  it('rejects invalid selectors before SQL reads', async () => {
    const h = await harness()
    expect(() => inspectHubWorkerDispatches(h.db, {
      ...h.selection, planSha: 'invalid'
    })).toThrow(/Invalid host-owned/)
  })
})
