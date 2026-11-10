import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { Coordinator } from '../runtime/orchestration/coordinator'
import type { CoordinatorRuntime } from '../runtime/orchestration/coordinator-runtime-contract'
import { reconcileLifecycleMessage } from '../runtime/orchestration/lifecycle-reconciliation'
import type { HubOfflineLabReport } from '../../shared/project-hub-offline-lab'

/**
 * Explicitly opt-in one-click *synthetic* test. All Run, Task and Dispatch
 * records live in an isolated SQLite :memory: instance and vanish on close.
 * It never reads/writes the user's orchestration DB, Git, CLI or network.
 *
 * The only virtual worker immediately settles one known synthetic Dispatch.
 * It must not be used as a permit or as evidence a real agent ran.
 */
export async function runProjectHubOfflineCoordinatorLab(): Promise<HubOfflineLabReport> {
  const db = new OrchestrationDb(':memory:')
  const events: string[] = []
  let fakeTurns = 0
  let terminalCreations = 0
  // A callback updates this asynchronously; avoid stale control-flow narrowing.
  const observedFakeTurns = (): number => fakeTurns
  const coordinatorHandle = 'project-hub-offline-coordinator'
  const workerHandle = 'project-hub-offline-fake-worker'
  let activeCoordinator: Coordinator | null = null

  try {
    const stagedRun = db.createRun({
      objective: 'Quarantined Project Hub sample',
      coordinatorHandle: null, coordinatorPaneKey: null
    })
    const stagedTask = db.createTask({
      runId: stagedRun.id,
      spec: JSON.stringify({
        source: 'adaptive-untrusted-plan',
        title: 'Untrusted staged sample (never dispatch)'
      })
    })

    const syntheticRun = db.createRun({
      objective: 'One-turn synthetic Coordinator exercise',
      coordinatorHandle: null, coordinatorPaneKey: null
    })
    const syntheticTask = db.createTask({
      runId: syntheticRun.id,
      spec: 'Offline fake worker only. No model, process or file access.'
    })

    const runtime: CoordinatorRuntime = {
      async listTerminals() {
        return { terminals: [{
          handle: workerHandle, worktreeId: 'synthetic-memory',
          connected: true, writable: true
        }] }
      },
      async createTerminal() {
        terminalCreations++
        throw new Error('Offline lab must never create a terminal')
      },
      async sendTerminalAgentPrompt(handle) {
        if (handle !== workerHandle || observedFakeTurns() !== 0) {
          throw new Error('Unexpected worker, duplicate prompt or live terminal')
        }
        const dispatch = db.getDispatchContext(syntheticTask.id)
        if (!dispatch || dispatch.assignee_handle !== workerHandle) {
          throw new Error('Synthetic task has no owned Dispatch')
        }
        fakeTurns++
        const message = db.insertMessage({
          runId: syntheticRun.id, from: workerHandle,
          to: coordinatorHandle, type: 'worker_done',
          subject: 'Synthetic completion (not real QA)',
          payload: JSON.stringify({
            taskId: syntheticTask.id, dispatchId: dispatch.id,
            outcome: 'succeeded'
          })
        })
        if (reconcileLifecycleMessage(db, message).action !== 'completed') {
          throw new Error('Native SQLite refused synthetic worker report')
        }
        return { accepted: true }
      },
      async waitForTerminal(handle) { return { handle, condition: 'exit' } },
      async probeWorktreeDrift() { return null }
    }

    // Even an explicitly selected staged Run must remain undispatchable.
    let refusedStaged = false
    try {
      await new Coordinator(db, runtime, {
        spec: 'Check staged quarantine without calling a worker',
        coordinatorHandle, taskRunId: stagedRun.id
      }).run()
    } catch (error) {
      if (!(error instanceof Error) || !/No tasks found/.test(error.message)) { throw error }
      refusedStaged = true
    }
    if (!refusedStaged || db.getDispatchContext(stagedTask.id) ||
        db.getTask(stagedTask.id)?.status !== 'ready' || fakeTurns !== 0) {
      throw new Error('Project Hub staged task escaped its dispatch quarantine')
    }
    events.push('staged_quarantine_verified')

    const coordinator = new Coordinator(db, runtime, {
      spec: 'One in-memory fake worker; no provider',
      coordinatorHandle, taskRunId: syntheticRun.id,
      maxConcurrent: 1, pollIntervalMs: 25
    })
    activeCoordinator = coordinator
    const execution = coordinator.run()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timed = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          coordinator.stop()
          reject(new Error('Offline Coordinator lab exceeded its 3-second deadline'))
        }, 3000)
      })
      const result = await Promise.race([execution, timed])
      if (result.status !== 'completed' ||
          db.getTask(syntheticTask.id)?.status !== 'completed' ||
          observedFakeTurns() !== 1 || terminalCreations !== 0) {
        throw new Error('Synthetic worker did not complete exactly one native turn')
      }
    } finally {
      if (timer) { clearTimeout(timer) }
      coordinator.stop()
      await execution.catch(() => {})
    }
    events.push('synthetic_worker_completed')

    const dispatchCount = db.db.prepare(
      'SELECT COUNT(*) AS count FROM dispatch_contexts WHERE task_id = ?'
    ).get(syntheticTask.id) as { count: number }
    if (dispatchCount.count !== 1 ||
        db.getDispatchContext(stagedTask.id) ||
        db.getTask(stagedTask.id)?.status !== 'ready') {
      throw new Error('Synthetic Run affected the quarantined Project Hub sample')
    }
    events.push('cross_run_isolation_verified')

    return {
      kind: 'synthetic-memory-only', status: 'passed',
      stagedRunQuarantined: true, syntheticRunCompleted: true,
      foreignRunUnchanged: true,
      fakeWorkerTurns: 1, syntheticDispatches: 1,
      terminalCreations: 0, modelCalls: 0, executionAuthorized: false,
      events
    }
  } finally {
    activeCoordinator?.stop()
    db.close()
  }
}
