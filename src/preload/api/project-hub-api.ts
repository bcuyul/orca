import type { HubOfflineLabRequest, HubOfflineLabReport } from '../../shared/project-hub-offline-lab'
import type { HubDispatchRecoveryReport } from '../../shared/project-hub-worker-dispatch-recovery'
import type { HubDocument } from '../../shared/project-hub-types'
import type { NativePlanPreview } from '../../shared/native-plan-preview'
import type { HubStageNativePlanRequest, HubStageNativePlanResult, HubInspectNativeStageRequest, HubNativeStageRecovery } from '../../shared/project-hub-supervised-stage'
export type ProjectHubApi = {
  runOfflineLab: (args: HubOfflineLabRequest) => Promise<HubOfflineLabReport>
  read: (projectId: string) => Promise<HubDocument>
  previewNativePlan: (args: { projectId: string; planId: string; expectedRevision: number }) => Promise<NativePlanPreview>
  stageNativePlan: (args: HubStageNativePlanRequest) => Promise<HubStageNativePlanResult>
  inspectStagedNativePlan: (args: HubInspectNativeStageRequest) => Promise<HubNativeStageRecovery>
  inspectWorkerDispatches: (args: HubInspectNativeStageRequest) => Promise<HubDispatchRecoveryReport>
  save: (args: { projectId: string; document: HubDocument; expectedRevision: number }) => Promise<HubDocument>
}
