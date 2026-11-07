import { ipcRenderer } from 'electron'
import type { ProjectHubApi } from './project-hub-api'
export const projectHubApi: ProjectHubApi = {
  read: (id) => ipcRenderer.invoke('projectHub:read',id),
  previewNativePlan: (args) => ipcRenderer.invoke('projectHub:previewNativePlan', args),
  stageNativePlan: (args) => ipcRenderer.invoke('projectHub:stageNativePlan', args),
  inspectStagedNativePlan: (args) => ipcRenderer.invoke('projectHub:inspectStagedNativePlan', args),
  save: (args) => ipcRenderer.invoke('projectHub:save',args)
}
