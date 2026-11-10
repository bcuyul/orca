import { describe, expect, it } from 'vitest'
import { runProjectHubOfflineCoordinatorLab } from './offline-coordinator-lab'
import { isHubOfflineLabRequest } from '../../shared/project-hub-offline-lab'

describe('Project Hub offline one-click laboratory', () => {
  it('runs native SQLite + Coordinator with a single in-memory fake worker', async () => {
    const result = await runProjectHubOfflineCoordinatorLab()
    expect(result).toEqual({
      kind: 'synthetic-memory-only', status: 'passed',
      stagedRunQuarantined: true, syntheticRunCompleted: true,
      foreignRunUnchanged: true,
      fakeWorkerTurns: 1, syntheticDispatches: 1,
      terminalCreations: 0, modelCalls: 0, executionAuthorized: false,
      events: [
        'staged_quarantine_verified', 'synthetic_worker_completed',
        'cross_run_isolation_verified'
      ]
    })
  })

  it('is repeatable without persistent state or duplicate Dispatch', async () => {
    const first = await runProjectHubOfflineCoordinatorLab()
    const second = await runProjectHubOfflineCoordinatorLab()
    expect(second).toEqual(first)
  })

  it('accepts only a narrow project identity input', () => {
    expect(isHubOfflineLabRequest({ projectId: 'repo:lab' })).toBe(true)
    for (const invalid of [
      {}, null, { projectId: '' }, { projectId: 'x'.repeat(501) },
      { projectId: 'repo:lab', launch: true }, ['repo:lab']
    ]) {
      expect(isHubOfflineLabRequest(invalid)).toBe(false)
    }
  })
})
