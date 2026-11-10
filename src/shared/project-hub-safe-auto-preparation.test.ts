import { describe, expect, it, vi } from 'vitest'
import type { NativePlanPreview } from './native-plan-preview'
import type {
  HubNativeStageRecovery, HubStageNativePlanResult
} from './project-hub-supervised-stage'
import type { HubOfflineLabReport } from './project-hub-offline-lab'
import {
  prepareHubPlanAutomatically, type HubSafeAutoPreparationDependencies,
  type HubSafeAutoPreparationInput
} from './project-hub-safe-auto-preparation'

const input: HubSafeAutoPreparationInput = {
  projectId: 'repo:lab', planId: 'plan-one', expectedRevision: 4,
  worktreeId: 'local:repo:worktree'
}
const preview: NativePlanPreview = {
  projectId: input.projectId, planId: input.planId,
  revision: 4, planSha: 'c'.repeat(64), objective: 'Safe preparation',
  approval: 'accepted', dispatched: false,
  tasks: [
    { id: 'qa', title: 'Review', role: 'qa', acceptance: 'Verified',
      dependsOn: ['forge'] },
    { id: 'forge', title: 'Implement', role: 'forge', acceptance: 'Tests pass',
      dependsOn: [] }
  ]
}
const lab: HubOfflineLabReport = {
  kind: 'synthetic-memory-only', status: 'passed',
  stagedRunQuarantined: true, syntheticRunCompleted: true,
  foreignRunUnchanged: true, fakeWorkerTurns: 1,
  syntheticDispatches: 1, terminalCreations: 0, modelCalls: 0,
  executionAuthorized: false, events: ['all synthetic tests passed']
}
const verified: HubNativeStageRecovery = {
  status: 'completed_verified', safeToRetry: false,
  executionAuthorized: false,
  entries: [{
    baseSha: 'd'.repeat(40), runId: 'run-one', state: 'completed',
    evidence: 'matched', disposition: 'completed_verified',
    tasks: { qa: 'native-qa', forge: 'native-forge' },
    dispatchCount: 0, unrecordedNativeTaskCount: 0, recordedTaskCount: 2
  }]
}
const empty: HubNativeStageRecovery = {
  status: 'not_found', safeToRetry: false,
  executionAuthorized: false, entries: []
}
const staged: HubStageNativePlanResult = {
  status: 'staged', projectId: input.projectId, planId: input.planId,
  runId: 'run-one', tasks: { qa: 'native-qa', forge: 'native-forge' },
  baseSha: 'd'.repeat(40), reused: false, dispatched: false
}
function fakeHost() {
  const dependencies = {
    offlineLab: vi.fn(async () => lab),
    preview: vi.fn(async () => preview),
    inspect: vi.fn(async () => verified),
    stage: vi.fn(async (): Promise<HubStageNativePlanResult> => staged)
  } satisfies HubSafeAutoPreparationDependencies
  return dependencies
}

describe('Project Hub automatic safe preparation, zero-token mode', () => {
  it('runs lab, host preview and recovery without asking consent for an already verified Run', async () => {
    const h = fakeHost()
    const steps: string[] = []
    const result = await prepareHubPlanAutomatically(input, h, s => { steps.push(s) })
    expect(result).toMatchObject({
      status: 'prepared', reused: true, executionAuthorized: false,
      dispatchAllowed: false,
      readiness: { status: 'candidates-only', runId: 'run-one',
        candidates: [{ taskId: 'forge', nativeTaskId: 'native-forge' }],
        waiting: [{ taskId: 'qa', dependsOn: ['forge'] }] }
    })
    expect(steps).toEqual(['offline_lab', 'host_preview', 'host_recovery', 'prepared'])
    expect(h.stage).not.toHaveBeenCalled()
    expect(h.inspect).toHaveBeenCalledWith({
      ...input, planSha: preview.planSha
    })
  })

  it('creates exactly one staged Run only after existing receipt is absent and host consents', async () => {
    const h = fakeHost()
    h.inspect.mockResolvedValueOnce(empty)
    const result = await prepareHubPlanAutomatically(input, h)
    expect(result).toMatchObject({
      status: 'prepared', reused: false, executionAuthorized: false,
      dispatchAllowed: false,
      steps: [
        'offline_lab', 'host_preview', 'host_recovery',
        'host_confirmation', 'verify_receipt', 'prepared'
      ]
    })
    expect(h.stage).toHaveBeenCalledOnce()
    expect(h.inspect).toHaveBeenCalledTimes(2)
    expect(h.preview).toHaveBeenCalledOnce()
  })

  it('cancellation from the native host dialog has no false success or retry', async () => {
    const h = fakeHost()
    h.inspect.mockResolvedValueOnce(empty)
    h.stage.mockResolvedValueOnce({ status: 'cancelled' })
    const result = await prepareHubPlanAutomatically(input, h)
    expect(result).toMatchObject({
      status: 'cancelled', steps: [
        'offline_lab', 'host_preview', 'host_recovery',
        'host_confirmation', 'cancelled'
      ]
    })
    expect(h.inspect).toHaveBeenCalledOnce()
    expect(h.stage).toHaveBeenCalledOnce()
  })

  it('never stages when synthetic preflight rejects the offline lab evidence', async () => {
    const h = fakeHost()
    h.offlineLab.mockResolvedValueOnce({ ...lab, modelCalls: 1 })
    await expect(prepareHubPlanAutomatically(input, h))
      .rejects.toThrow(/Offline synthetic preflight failed/)
    expect(h.preview).not.toHaveBeenCalled()
    expect(h.inspect).not.toHaveBeenCalled()
    expect(h.stage).not.toHaveBeenCalled()
  })

  it('blocks stale or unapproved plans before any write', async () => {
    for (const invalid of [
      { ...preview, approval: 'pending' as const },
      { ...preview, revision: 3 },
      { ...preview, projectId: 'another-project' },
      { ...preview, planSha: 'not-a-sha' }
    ]) {
      const h = fakeHost()
      h.preview.mockResolvedValueOnce(invalid)
      await expect(prepareHubPlanAutomatically(input, h))
        .rejects.toThrow(/no current approved/)
      expect(h.stage).not.toHaveBeenCalled()
      expect(h.inspect).not.toHaveBeenCalled()
    }
  })

  it('never retries uncertain or ambiguous native admission', async () => {
    for (const status of ['needs_reconciliation', 'multiple_verified'] as const) {
      const h = fakeHost()
      h.inspect.mockResolvedValueOnce({ ...verified, status })
      await expect(prepareHubPlanAutomatically(input, h))
        .rejects.toThrow(/manual reconciliation/)
      expect(h.stage).not.toHaveBeenCalled()
      expect(h.inspect).toHaveBeenCalledOnce()
    }
  })

  it('refuses a new Run if its second host inspection is missing or divergent', async () => {
    for (const recovery of [
      empty, { ...verified, entries: [{ ...verified.entries[0]!, dispatchCount: 1 }] },
      { ...verified, entries: [{ ...verified.entries[0]!, tasks: { forge: 'other', qa: 'native-qa' } }] }
    ]) {
      const h = fakeHost()
      h.inspect.mockResolvedValueOnce(empty).mockResolvedValueOnce(recovery)
      await expect(prepareHubPlanAutomatically(input, h))
        .rejects.toThrow(/incomplete|uncertain|differs/)
      expect(h.stage).toHaveBeenCalledOnce()
      expect(h.inspect).toHaveBeenCalledTimes(2)
    }
  })

  it('refuses an existing verified-looking Run with a hidden Dispatch', async () => {
    const h = fakeHost()
    h.inspect.mockResolvedValueOnce({
      ...verified, entries: [{ ...verified.entries[0]!, dispatchCount: 1 }]
    })
    await expect(prepareHubPlanAutomatically(input, h))
      .rejects.toThrow(/incomplete or uncertain/)
    expect(h.stage).not.toHaveBeenCalled()
  })

  it('rejects invalid identifiers before preflight', async () => {
    const h = fakeHost()
    await expect(prepareHubPlanAutomatically({ ...input, expectedRevision: -1 }, h))
      .rejects.toThrow(/Invalid automatic/)
    expect(h.offlineLab).not.toHaveBeenCalled()
  })
})
