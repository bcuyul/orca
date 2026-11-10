import type { NativePlanPreview } from './native-plan-preview'
import type {
  HubInspectNativeStageRequest, HubNativeStageRecovery,
  HubStageNativePlanResult, HubStagedNativePlan
} from './project-hub-supervised-stage'
import type { HubOfflineLabReport } from './project-hub-offline-lab'
import {
  evaluateHubWorkerReadiness, type HubWorkerReadiness
} from './project-hub-worker-readiness'

export type HubSafeAutoPreparationInput = {
  projectId: string
  planId: string
  expectedRevision: number
  worktreeId: string
}

export type HubSafeAutoPreparationDependencies = {
  offlineLab: (projectId: string) => Promise<HubOfflineLabReport>
  preview: (args: {
    projectId: string; planId: string; expectedRevision: number
  }) => Promise<NativePlanPreview>
  inspect: (args: HubInspectNativeStageRequest) => Promise<HubNativeStageRecovery>
  stage: (args: HubInspectNativeStageRequest) => Promise<HubStageNativePlanResult>
}

export type HubSafeAutoStep =
  'offline_lab' | 'host_preview' | 'host_recovery' | 'host_confirmation' |
  'verify_receipt' | 'prepared' | 'cancelled'

export type HubSafeAutoPreparationOutcome =
  | { status: 'cancelled'; preview: NativePlanPreview; steps: HubSafeAutoStep[] }
  | {
    status: 'prepared'
    preview: NativePlanPreview
    recovery: HubNativeStageRecovery
    receipt: HubStagedNativePlan | null
    reused: boolean
    readiness: HubWorkerReadiness
    steps: HubSafeAutoStep[]
    executionAuthorized: false
    dispatchAllowed: false
  }

function assertLab(report: HubOfflineLabReport): void {
  if (report.kind !== 'synthetic-memory-only' || report.status !== 'passed' ||
      report.stagedRunQuarantined !== true ||
      report.syntheticRunCompleted !== true ||
      report.foreignRunUnchanged !== true || report.fakeWorkerTurns !== 1 ||
      report.syntheticDispatches !== 1 || report.terminalCreations !== 0 ||
      report.modelCalls !== 0 || report.executionAuthorized !== false) {
    throw new Error('Offline synthetic preflight failed; no Run materialization allowed')
  }
}

function assertReadiness(
  preview: NativePlanPreview,
  recovery: HubNativeStageRecovery,
  receipt: HubStagedNativePlan | null
): HubWorkerReadiness {
  const readiness = evaluateHubWorkerReadiness(preview, recovery)
  if (readiness.status !== 'candidates-only' ||
      readiness.executionAuthorized !== false ||
      readiness.dispatchAllowed !== false ||
      !readiness.runId || !readiness.candidates.length) {
    throw new Error('Native Run receipt is incomplete or uncertain; reconcile with host')
  }
  if (receipt && (receipt.runId !== readiness.runId ||
      receipt.planId !== preview.planId || receipt.projectId !== preview.projectId ||
      receipt.dispatched !== false ||
      Object.keys(receipt.tasks).length !== preview.tasks.length ||
      preview.tasks.some(task => receipt.tasks[task.id] !==
        recovery.entries[0]?.tasks?.[task.id]))) {
    throw new Error('Native Run receipt differs from verified host recovery')
  }
  return readiness
}

/**
 * One user action, several deterministic *control-plane* steps.
 * It reuses the protected Electron IPC functions and does NOT grant execution.
 * Any ambiguous recovery is a stop condition, never a retry.
 * The native stage operation still asks for separate human approval.
 */
export async function prepareHubPlanAutomatically(
  input: HubSafeAutoPreparationInput,
  host: HubSafeAutoPreparationDependencies,
  onStep: (step: HubSafeAutoStep) => void = () => {}
): Promise<HubSafeAutoPreparationOutcome> {
  if (!input.projectId || !input.planId || !input.worktreeId ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Invalid automatic preparation selection')
  }
  const steps: HubSafeAutoStep[] = []
  const next = (step: HubSafeAutoStep): void => { steps.push(step); onStep(step) }

  next('offline_lab')
  assertLab(await host.offlineLab(input.projectId))

  next('host_preview')
  const preview = await host.preview({
    projectId: input.projectId, planId: input.planId,
    expectedRevision: input.expectedRevision
  })
  if (preview.projectId !== input.projectId ||
      preview.planId !== input.planId ||
      preview.revision !== input.expectedRevision ||
      preview.approval !== 'accepted' || preview.dispatched !== false ||
      !/^[a-f0-9]{64}$/i.test(preview.planSha)) {
    throw new Error('Host has no current approved native plan for this selection')
  }
  const inspectRequest: HubInspectNativeStageRequest = {
    projectId: input.projectId, planId: input.planId,
    expectedRevision: input.expectedRevision,
    planSha: preview.planSha, worktreeId: input.worktreeId
  }
  next('host_recovery')
  let recovery = await host.inspect(inspectRequest)
  let receipt: HubStagedNativePlan | null = null

  if (recovery.status === 'not_found') {
    // Host stage has its own approval dialog and repeats Git/plan validation.
    next('host_confirmation')
    const staged = await host.stage(inspectRequest)
    if (staged.status === 'cancelled') {
      next('cancelled')
      return { status: 'cancelled', preview, steps }
    }
    receipt = staged
    next('verify_receipt')
    recovery = await host.inspect(inspectRequest)
  } else if (recovery.status !== 'completed_verified') {
    throw new Error('Existing native Run requires manual reconciliation; no retry')
  }

  const readiness = assertReadiness(preview, recovery, receipt)
  next('prepared')
  return {
    status: 'prepared', preview, recovery, receipt,
    reused: receipt === null || receipt.reused,
    readiness, steps, executionAuthorized: false, dispatchAllowed: false
  }
}
