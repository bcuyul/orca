/**
 * Real Orca SQLite + Coordinator regression with an in-memory worker transport.
 * NO provider, API call, process spawn, terminal, push, merge or network usage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { Coordinator } from '../runtime/orchestration/coordinator'
import type { CoordinatorRuntime } from '../runtime/orchestration/coordinator-runtime-contract'
import { reconcileLifecycleMessage } from '../runtime/orchestration/lifecycle-reconciliation'
import { emptyProjectHub } from '../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../shared/project-hub-intelligence'
import { buildNativePlanPreview } from './native-plan-preview'
import { stageHubNativePlan, type HubStageHostDependencies } from './supervised-native-plan-stage'
import { inspectHubNativeStages } from './native-stage-recovery'

const openDbs: OrchestrationDb[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const db of openDbs.splice(0)) { db.close() }
})

const plan: HubPlanProposal = {
  id: 'zero-token-plan', source: 'atlas-proposal',
  objective: 'Validate Forge then QA without a paid CLI',
  rationale: 'An isolated fake worker must not unlock staged Project Hub Tasks',
  createdAt: '2026-11-09T12:00:00Z',
  tasks: [
    { id: 'qa', title: 'Independent review', role: 'qa',
      dependsOn: ['forge'], acceptance: 'No unverified results' },
    { id: 'forge', title: 'Implement change', role: 'forge',
      dependsOn: [], acceptance: 'Relevant tests pass' }
  ]
}

function lab() {
  const projectId = 'repo:zero-token-lab'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan],
      decisions: [{
        id: 'human-1', subject: 'plan' as const,
        subjectId: plan.id, verdict: 'accepted' as const,
        justification: 'Reviewed lab DAG and no-CLI boundary',
        createdAt: '2026-11-09T12:01:00Z'
      }]
    }
  }
  const db = new OrchestrationDb(':memory:')
  openDbs.push(db)
  const worktree = {
    projectId, repoId: 'repo:zero-token-lab', hostId: 'local',
    worktreeId: 'zero-token::worktree', baseSha: 'a'.repeat(40)
  }
  const host: HubStageHostDependencies = {
    readProject: () => doc,
    inspectWorktree: async () => ({ ...worktree }),
    confirmInHostWindow: async () => true,
    getOrchestrationDb: () => db
  }
  const preview = buildNativePlanPreview(doc, plan.id, 2)
  const request = {
    projectId, planId: plan.id, expectedRevision: 2,
    planSha: preview.planSha, worktreeId: worktree.worktreeId
  }
  return { db, host, preview, request, worktree }
}

function fakeWorker() {
  const prompts: { handle: string; prompt: string }[] = []
  let terminalCreations = 0
  const runtime: CoordinatorRuntime = {
    async sendTerminalAgentPrompt(handle, prompt) {
      prompts.push({ handle, prompt })
      return { accepted: true }
    },
    async listTerminals() {
      return { terminals: [{
        handle: 'fake-worker-1', worktreeId: 'zero-token-lab',
        connected: true, writable: true
      }] }
    },
    async createTerminal() {
      terminalCreations++
      throw new Error('Real terminal creation is prohibited in this lab')
    },
    async waitForTerminal(handle) { return { handle, condition: 'exit' } },
    async probeWorktreeDrift() { return null }
  }
  return { runtime, prompts, getTerminalCreations: () => terminalCreations }
}

describe('Project Hub zero-token lab with real SQLite', () => {
  it('keeps an approved native Project Hub DAG quarantined from a fake Coordinator', async () => {
    const h = lab()
    const staged = await stageHubNativePlan(h.request, h.host)
    if (staged.status !== 'staged') { throw new Error('Expected a staged native Run') }
    const receipt = inspectHubNativeStages(h.db, h.preview, h.worktree)
    expect(receipt).toMatchObject({
      status: 'completed_verified', executionAuthorized: false,
      entries: [{ runId: staged.runId, dispatchCount: 0 }]
    })
    const fake = fakeWorker()
    await expect(new Coordinator(h.db, fake.runtime, {
      spec: 'Synthetic staged attempt (must be denied)',
      coordinatorHandle: 'zero-token-coordinator',
      taskRunId: staged.runId
    }).run()).rejects.toThrow(/No tasks found/)
    expect(fake.prompts).toHaveLength(0)
    expect(fake.getTerminalCreations()).toBe(0)
    expect(h.db.getDispatchContext(staged.tasks.forge!)).toBeUndefined()
    expect(h.db.getDispatchContext(staged.tasks.qa!)).toBeUndefined()
    expect(h.db.getTask(staged.tasks.forge!)?.status).toBe('ready')
  })

  it('completes a distinct synthetic native Run without touching staged Project Hub tasks', async () => {
    const h = lab()
    const staged = await stageHubNativePlan(h.request, h.host)
    if (staged.status !== 'staged') { throw new Error('Expected a staged native Run') }
    const ordinary = h.db.createRun({
      objective: 'Synthetic zero-token worker',
      coordinatorHandle: null, coordinatorPaneKey: null
    })
    const target = h.db.createTask({
      runId: ordinary.id, spec: 'In-memory mock test; no model invocation'
    })
    const fake = fakeWorker()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const coordinator = new Coordinator(h.db, fake.runtime, {
      spec: 'Run-scoped in-memory fake worker',
      coordinatorHandle: 'zero-token-coordinator',
      taskRunId: ordinary.id, maxConcurrent: 1, pollIntervalMs: 50
    })
    const execution = coordinator.run()
    try {
      await vi.advanceTimersByTimeAsync(100)
      expect(fake.prompts).toHaveLength(1)
      const dispatch = h.db.getDispatchContext(target.id)
      expect(dispatch?.assignee_handle).toBe('fake-worker-1')
      expect(h.db.getDispatchContext(staged.tasks.forge!)).toBeUndefined()
      expect(h.db.getDispatchContext(staged.tasks.qa!)).toBeUndefined()

      const message = h.db.insertMessage({
        runId: ordinary.id, from: 'fake-worker-1',
        to: 'zero-token-coordinator', subject: 'Synthetic completion',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId: target.id, dispatchId: dispatch!.id, outcome: 'succeeded'
        })
      })
      reconcileLifecycleMessage(h.db, message)
      await vi.advanceTimersByTimeAsync(150)
      const result = await execution
      expect(result.status).toBe('completed')
      expect(h.db.getTask(target.id)?.status).toBe('completed')
      expect(h.db.getTask(staged.tasks.forge!)?.status).toBe('ready')
      expect(h.db.getDispatchContext(staged.tasks.forge!)).toBeUndefined()
      expect(fake.prompts).toHaveLength(1)
      expect(fake.getTerminalCreations()).toBe(0)
    } finally {
      coordinator.stop()
      await vi.runOnlyPendingTimersAsync()
      await execution.catch(() => {})
    }
  })
})
