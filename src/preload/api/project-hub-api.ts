import type { HubDocument } from '../../shared/project-hub-types'
import type { NativePlanPreview } from '../../shared/native-plan-preview'
import type { HubStageNativePlanRequest, HubStageNativePlanResult } from '../../shared/project-hub-supervised-stage'
export type ProjectHubApi = {
  read: (projectId: string) => Promise<HubDocument>
  previewNativePlan: (args: { projectId: string; planId: string; expectedRevision: number }) => Promise<NativePlanPreview>
  stageNativePlan: (args: HubStageNativePlanRequest) => Promise<HubStageNativePlanResult>
  save: (args: { projectId: string; document: HubDocument; expectedRevision: number }) => Promise<HubDocument>
}
