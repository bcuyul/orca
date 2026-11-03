import { describe, expect, it, vi, afterEach } from 'vitest'
import { Coordinator } from './coordinator'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import type { CoordinatorRuntime } from './coordinator-runtime-contract'

afterEach(() => vi.useRealTimers())

function fakeRuntime() {
  const calls: { handle: string; prompt: string }[] = []
  const runtime: CoordinatorRuntime = {
    async sendTerminalAgentPrompt(handle, prompt) {
      calls.push({ handle, prompt })
      return { accepted: true }
    },
    async listTerminals() {
      return { terminals: [{ handle: 'worker-one', worktreeId: 'lab', connected: true, writable: true }] }
    },
    async createTerminal() { throw new Error('Unexpected terminal creation') },
    async waitForTerminal(handle) { return { handle, condition: 'exit' } },
    async probeWorktreeDrift() { return null }
  }
  return { runtime, calls }
}

function addRun(db: OrchestrationDb, label: string) {
  return db.createRun({ objective: label, coordinatorHandle: null, coordinatorPaneKey: null })
}

describe('native Run-scoped Coordinator, fake worker only', () => {
  it('does not allow a nonexistent native Run to drive the Coordinator', async () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const fake = fakeRuntime()
      const coordinator = new Coordinator(db, fake.runtime, {
        spec: 'not authorized to scope missing run',
        coordinatorHandle: 'coordinator', taskRunId: 'missing-native-run'
      })
      await expect(coordinator.run()).rejects.toThrow(/Run not found/)
      expect(fake.calls).toHaveLength(0)
      expect(db.db.prepare('SELECT COUNT(*) AS count FROM coordinator_runs').get())
        .toMatchObject({ count: 0 })
    } finally { db.close() }
  })

  it('does not create terminal or dispatch when scoped Run has no tasks', async () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const run = addRun(db, 'empty scoped run')
      const other = addRun(db, 'other run')
      const unrelated = db.createTask({ runId: other.id, spec: 'must remain untouched' })
      const fake = fakeRuntime()
      await expect(new Coordinator(db, fake.runtime, {
        spec: 'no task in my run',
        coordinatorHandle: 'coordinator', taskRunId: run.id
      }).run()).rejects.toThrow(/No tasks found/)
      expect(fake.calls).toHaveLength(0)
      expect(db.getTask(unrelated.id)?.status).toBe('ready')
      expect(db.getDispatchContext(unrelated.id)).toBeUndefined()
    } finally { db.close() }
  })

  it('completes one scoped native Run with a fake worker, never dispatches other Run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] })
    const db = new OrchestrationDb(':memory:')
    let execution: ReturnType<Coordinator['run']> | undefined
    let coordinator: Coordinator | undefined
    try {
      const selected = addRun(db, 'selected microtask')
      const excluded = addRun(db, 'different project')
      const target = db.createTask({ runId: selected.id, spec: 'apply one safe isolated change' })
      const foreign = db.createTask({ runId: excluded.id, spec: 'do not run this' })
      const fake = fakeRuntime()
      coordinator = new Coordinator(db, fake.runtime, {
        spec: 'dry-run with synthetic worker',
        coordinatorHandle: 'coordinator', taskRunId: selected.id,
        pollIntervalMs: 50, maxConcurrent: 1
      })
      execution = coordinator.run()
      await vi.advanceTimersByTimeAsync(100)
      expect(fake.calls).toHaveLength(1)
      const dispatch = db.getDispatchContext(target.id)
      expect(dispatch?.assignee_handle).toBe('worker-one')
      expect(db.getDispatchContext(foreign.id)).toBeUndefined()

      // A foreign message with the same coordinator handle must remain unread.
      const otherMsg = db.insertMessage({
        runId: excluded.id, from: 'another-worker', to: 'coordinator',
        subject: 'foreign status', type: 'status'
      })
      const doneMsg = db.insertMessage({
        runId: selected.id, from: 'worker-one', to: 'coordinator',
        subject: 'Done', type: 'worker_done',
        payload: JSON.stringify({ taskId: target.id, dispatchId: dispatch?.id, outcome: 'succeeded' })
      })
      // Same lifecycle reconciliation helper as the existing Coordinator regression.
      reconcileLifecycleMessage(db, doneMsg)
      await vi.advanceTimersByTimeAsync(150)
      const result = await execution
      expect(result.status).toBe('completed')
      expect(db.getTask(target.id)?.status).toBe('completed')
      expect(db.getTask(foreign.id)?.status).toBe('ready')
      expect(db.getMessageById(otherMsg.id)?.read).toBe(0)
      expect(db.getDispatchContext(foreign.id)).toBeUndefined()
      expect(fake.calls).toHaveLength(1)
    } finally {
      coordinator?.stop()
      if (execution) { await vi.runOnlyPendingTimersAsync(); await execution.catch(() => {}) }
      db.close()
    }
  })

  it('rejects staged adaptive Tasks even in an explicitly scoped Run', async () => {
    const db = new OrchestrationDb(':memory:')
    try {
      const native = addRun(db, 'staged plan')
      const staged = db.createTask({
        runId: native.id,
        spec: JSON.stringify({ source: 'adaptive-untrusted-plan', title: 'not authorized' })
      })
      const fake = fakeRuntime()
      await expect(new Coordinator(db, fake.runtime, {
        spec: 'must not activate staged task',
        coordinatorHandle: 'coordinator', taskRunId: native.id
      }).run()).rejects.toThrow(/No tasks found/)
      expect(db.getTask(staged.id)?.status).toBe('ready')
      expect(fake.calls).toHaveLength(0)
    } finally { db.close() }
  })
})
