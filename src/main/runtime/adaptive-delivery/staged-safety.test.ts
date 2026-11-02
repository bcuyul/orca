import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AdaptiveRequest, AdaptiveScope } from '../../../shared/adaptive-delivery/admission-contracts'
import type { HubPlanProposal } from '../../../shared/project-hub-intelligence'
import { emptyHubIntelligence } from '../../../shared/project-hub-intelligence'
import { emptyProjectHub, type HubDocument } from '../../../shared/project-hub-types'
import { isAdaptiveStagedTaskSpec } from '../orchestration/adaptive-staged-task'
import { Coordinator } from '../orchestration/coordinator'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { HostAdmissionLedger } from './host-admission-ledger'
import { NativePlanMaterializer } from './native-plan-materializer'

const plan: HubPlanProposal = {
  id: 'plan-staging', objective: 'Implement one isolated booking use case',
  rationale: 'Verify staging cannot dispatch without a host execution grant',
  source: 'human', createdAt: '2026-11-02T10:00:00Z',
  tasks: [{ id: 'task-a', title: 'Build isolated booking storage',
    role: 'data', dependsOn: [], acceptance: 'Storage saves test bookings' }]
}
const planSha = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
const request: AdaptiveRequest = {
  requestId: 'staging-test', scopeId: 'scope-staging',
  projectId: 'project-test', repoId: 'repo-test', hostId: 'host-test',
  baseSha: 'b'.repeat(40), planId: plan.id, planSha,
  taskIds: ['task-a'], operation: 'materialize_run'
}
const scope: AdaptiveScope = {
  projectId: request.projectId, repoId: request.repoId, hostId: request.hostId,
  baseSha: request.baseSha, planId: plan.id, planSha, allowedTaskIds: ['task-a'],
  operations: ['materialize_run'], maxOperations: 1,
  expiresAt: '2099-01-01T00:00:00Z'
}
const doc: HubDocument = {
  ...emptyProjectHub('project-test'), revision: 3,
  intelligence: { ...emptyHubIntelligence(), plans: [plan],
    decisions: [{ id: 'decision-approved', subject: 'plan', subjectId: plan.id,
      verdict: 'accepted', justification: 'Reviewed scope and test plan',
      createdAt: '2026-11-02T11:00:00Z' }] }
}
function stagedTask(db: OrchestrationDb): string {
  const ledger = new HostAdmissionLedger(db)
  ledger.recordHostApproval(request.scopeId, scope)
  const reader = { read: (id: string): HubDocument => {
    if (id !== doc.projectId) { throw new Error('Project unavailable') }
    return doc
  } }
  return new NativePlanMaterializer(db, ledger, reader).materialize({
    admission: request, expectedHubRevision: doc.revision,
    nowMs: Date.parse('2026-11-02T12:00:00Z')
  }).tasks['task-a']
}
function fakeRuntime() {
  return {
    listTerminals: vi.fn(async () => ({ terminals: [] })),
    createTerminal: vi.fn(async () => ({ handle: 'mock-worker', worktreeId: 'lab' })),
    sendTerminalAgentPrompt: vi.fn(async () => ({ accepted: true })),
    waitForTerminal: async (handle: string) => ({ handle, condition: 'exit' as const }),
    probeWorktreeDrift: async () => null
  }
}
describe('staged native Run/Task is never an authorized Dispatch', () => {
  it('identifies only the exact staged provenance marker', () => {
    expect(isAdaptiveStagedTaskSpec(JSON.stringify({ source: 'adaptive-untrusted-plan' }))).toBe(true)
    expect(isAdaptiveStagedTaskSpec(JSON.stringify({ source: 'legacy' }))).toBe(false)
    expect(isAdaptiveStagedTaskSpec('text adaptive-untrusted-plan')).toBe(false)
    expect(isAdaptiveStagedTaskSpec('{not valid')).toBe(false)
  })
  it('creates a real native plan without allowing a Dispatch by API or raw SQL', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const taskId = stagedTask(db)
      const task = db.getTask(taskId)
      expect(task?.status).toBe('ready')
      expect(isAdaptiveStagedTaskSpec(task!.spec)).toBe(true)
      expect(() => db.createDispatchContext({
        taskId, assigneeHandle: 'simulated-worker',
        creator: { kind: 'system' }, maxDepth: 1
      })).toThrow(/adaptive_staged_not_authorized/)
      expect(() => db.db.prepare(
        "INSERT INTO dispatch_contexts (id, run_id, task_id, status) VALUES ('bypass', ?, ?, 'pending')"
      ).run(task!.run_id, taskId)).toThrow(/adaptive_staged_not_authorized/)
      expect(db.db.prepare('SELECT COUNT(*) AS count FROM dispatch_contexts').get())
        .toMatchObject({ count: 0 })
      expect(db.db.prepare('SELECT COUNT(*) AS count FROM coordinator_runs').get())
        .toMatchObject({ count: 0 })
    } finally {
      db.close()
    }
  })
  it('Coordinator never creates a worker terminal for a staged-only plan', async () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const taskId = stagedTask(db)
      const runtime = fakeRuntime()
      const coordinator = new Coordinator(db, runtime, {
        spec: 'unrelated coordinator', coordinatorHandle: 'coord', pollIntervalMs: 10
      })
      await expect(coordinator.run()).rejects.toThrow(/No tasks found/)
      expect(runtime.createTerminal).not.toHaveBeenCalled()
      expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
      expect(runtime.listTerminals).not.toHaveBeenCalled()
      expect(db.getTask(taskId)?.status).toBe('ready')
    } finally {
      db.close()
    }
  })
  it('Coordinator can finish unrelated work without taking staged tasks', async () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const taskId = stagedTask(db)
      const ordinary = db.createTask({
        runId: 'run_legacy_local', spec: 'ordinary completed task'
      })
      db.updateTaskStatus(ordinary.id, 'completed')
      const runtime = fakeRuntime()
      const result = await new Coordinator(db, runtime, {
        spec: 'unrelated coordinator', coordinatorHandle: 'coord', pollIntervalMs: 10
      }).run()
      expect(result.status).toBe('completed')
      expect(runtime.createTerminal).not.toHaveBeenCalled()
      expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
      expect(db.getTask(taskId)?.status).toBe('ready')
    } finally {
      db.close()
    }
  })
  it('still permits regular native Dispatches', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      stagedTask(db)
      const ordinary = db.createTask({ runId: 'run_legacy_local', spec: 'regular work' })
      const result = db.createDispatchContext({
        taskId: ordinary.id, assigneeHandle: 'worker-1',
        creator: { kind: 'system' }, maxDepth: 1
      })
      expect(result.task_id).toBe(ordinary.id)
      expect(db.getTask(ordinary.id)?.status).toBe('dispatched')
    } finally {
      db.close()
    }
  })
  it('SQLite dispatch fence survives process restart without a new ledger', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-adaptive-stage-'))
    const path = join(directory, 'runtime.sqlite')
    let taskId = ''
    try {
      const before = new OrchestrationDb(path)
      try { taskId = stagedTask(before) } finally { before.close() }
      const after = new OrchestrationDb(path)
      try {
        expect(() => after.createDispatchContext({
          taskId, assigneeHandle: 'worker-after-restart',
          creator: { kind: 'system' }, maxDepth: 1
        })).toThrow(/adaptive_staged_not_authorized/)
        expect(after.getTask(taskId)?.status).toBe('ready')
        expect(after.db.prepare('SELECT COUNT(*) AS count FROM dispatch_contexts').get())
          .toMatchObject({ count: 0 })
      } finally {
        after.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
