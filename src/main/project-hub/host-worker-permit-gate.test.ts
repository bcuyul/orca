import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { emptyProjectHub } from '../../shared/project-hub-types'
import {
  emptyHubIntelligence, type HubPlanProposal
} from '../../shared/project-hub-intelligence'
import type { AgentSandboxEvidence } from '../runtime/adaptive-delivery/execution-sandbox-policy'
import { buildNativePlanPreview } from './native-plan-preview'
import {
  stageHubNativePlan, type HubStageHostDependencies
} from './supervised-native-plan-stage'
import {
  prepareHubOneWorkerPermit, type HubWorkerPermitHostDependencies
} from './host-worker-permit-gate'

const databases: OrchestrationDb[] = []
afterEach(() => { for (const db of databases.splice(0)) { db.close() } })

const plan: HubPlanProposal = {
  id: 'plan-permit', objective: 'Implement and review one safe feature',
  rationale: 'Check native authority and budget with no CLI launch',
  source: 'human', createdAt: '2026-11-10T12:00:00Z',
  tasks: [
    { id: 'forge', title: 'Implement', role: 'forge',
      acceptance: 'Focused tests pass', dependsOn: [] },
    { id: 'qa', title: 'Review', role: 'qa',
      acceptance: 'Independent evidence', dependsOn: ['forge'] }
  ]
}

function createHarness() {
  const projectId = 'repo:permit-lab'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan], decisions: [{
        id: 'human-plan-one', subject: 'plan' as const, subjectId: plan.id,
        verdict: 'accepted' as const, justification: 'Reviewed DAG and scope',
        createdAt: '2026-11-10T12:10:00Z'
      }]
    }
  }
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const worktree = {
    worktreeId: 'worktree-local', repoId: 'repo-permit-lab',
    projectId, hostId: 'local', baseSha: 'a'.repeat(40)
  }
  const inspect = vi.fn(async () => ({ ...worktree }))
  const sandbox = {
    inspectSandbox: vi.fn((): AgentSandboxEvidence | null => ({
      kind: 'os-enforced', sandboxId: 'test-sandbox',
      filesystem: 'restricted', network: 'restricted',
      childProcesses: 'confined', policyDigest: 'b'.repeat(64)
    }))
  }
  const consent = vi.fn(async () => true)
  const stageHost: HubStageHostDependencies = {
    readProject: () => doc,
    inspectWorktree: inspect,
    confirmInHostWindow: async () => true,
    getOrchestrationDb: () => db
  }
  const permitHost: HubWorkerPermitHostDependencies = {
    readProject: () => doc, inspectWorktree: inspect,
    getOrchestrationDb: () => db,
    sandbox, confirmOneTurnInHostWindow: consent
  }
  const preview = buildNativePlanPreview(doc, plan.id, doc.revision)
  const request = {
    projectId, planId: plan.id,
    expectedRevision: doc.revision, planSha: preview.planSha,
    worktreeId: worktree.worktreeId
  }
  return { db, doc, worktree, inspect, sandbox, consent, stageHost, permitHost, request }
}

async function readyHarness() {
  const h = createHarness()
  const receipt = await stageHubNativePlan(h.request, h.stageHost)
  if (receipt.status !== 'staged') { throw new Error('Expected native Run') }
  return { ...h, receipt, input: { ...h.request, hubTaskId: 'forge' } }
}
const tableCount = (db: OrchestrationDb, name: string): number => {
  const row = db.db.prepare(`SELECT COUNT(*) AS total FROM ${name}`).get() as { total: number }
  return row.total
}

describe('Host-only worker permit: real SQLite, no tokens and no Dispatch', () => {
  it('authenticates a different host decision, reserves exactly one turn and keeps Dispatch blocked', async () => {
    const h = await readyHarness()
    const first = await prepareHubOneWorkerPermit(h.input, h.permitHost)
    expect(first).toMatchObject({
      status: 'prepared', dispatched: false, executionAuthorized: false,
      permit: {
        state: 'prepared', dispatched: false,
        runId: h.receipt.runId, taskId: h.receipt.tasks.forge
      }
    })
    expect(h.consent).toHaveBeenCalledOnce()
    expect(tableCount(h.db, 'adaptive_execution_permits')).toBe(1)
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
    expect(() => h.db.createDispatchContext({
      taskId: h.receipt.tasks.forge!, assigneeHandle: 'untrusted-worker',
      creator: { kind: 'system' }, maxDepth: 1
    })).toThrow(/adaptive_staged_not_authorized/)
    const second = await prepareHubOneWorkerPermit(h.input, h.permitHost)
    expect(second).toEqual(first)
    expect(tableCount(h.db, 'adaptive_execution_permits')).toBe(1)
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('rejects a worktree-only sandbox before prompting or writing grants', async () => {
    const h = await readyHarness()
    h.sandbox.inspectSandbox.mockReturnValue({ kind: 'worktree-only' })
    await expect(prepareHubOneWorkerPermit(h.input, h.permitHost))
      .rejects.toThrow(/execution_sandbox_required/)
    expect(h.consent).not.toHaveBeenCalled()
    expect(tableCount(h.db, 'adaptive_scope_grants')).toBe(1)
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('does not create a permit when the user cancels execution consent', async () => {
    const h = await readyHarness()
    h.consent.mockResolvedValueOnce(false)
    expect(await prepareHubOneWorkerPermit(h.input, h.permitHost)).toEqual({
      status: 'cancelled', dispatched: false, executionAuthorized: false
    })
    expect(tableCount(h.db, 'adaptive_execution_permits')).toBe(0)
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('blocks dependent QA until implementation is complete', async () => {
    const h = await readyHarness()
    await expect(prepareHubOneWorkerPermit({
      ...h.input, hubTaskId: 'qa'
    }, h.permitHost)).rejects.toThrow(/dependency-free/)
    expect(h.consent).not.toHaveBeenCalled()
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('rejects Git drift after the human host dialog', async () => {
    const h = await readyHarness()
    h.inspect.mockResolvedValueOnce({ ...h.worktree })
      .mockResolvedValueOnce({ ...h.worktree, baseSha: 'f'.repeat(40) })
    await expect(prepareHubOneWorkerPermit(h.input, h.permitHost))
      .rejects.toThrow(/changed while confirming/)
    expect(tableCount(h.db, 'adaptive_execution_permits')).toBe(0)
    expect(tableCount(h.db, 'dispatch_contexts')).toBe(0)
  })

  it('blocks stale plan SHA, unknown tasks and wrong project identities', async () => {
    const h = await readyHarness()
    for (const bad of [
      { ...h.input, planSha: '0'.repeat(64) },
      { ...h.input, hubTaskId: 'not-in-plan' },
      { ...h.input, projectId: 'other-project' }
    ]) {
      await expect(prepareHubOneWorkerPermit(bad, h.permitHost)).rejects.toThrow()
    }
    expect(h.consent).not.toHaveBeenCalled()
    expect(tableCount(h.db, 'adaptive_execution_permits')).toBe(0)
  })

  it('blocks malformed task ID before accessing the host', async () => {
    const h = await readyHarness()
    await expect(prepareHubOneWorkerPermit({
      ...h.input, hubTaskId: '../suspicious'
    }, h.permitHost)).rejects.toThrow(/Invalid native worker-permit/)
    expect(h.consent).not.toHaveBeenCalled()
  })
})
