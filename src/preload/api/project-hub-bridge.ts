import { ipcRenderer } from 'electron'
import type { ProjectHubApi } from './project-hub-api'
export const projectHubApi: ProjectHubApi = {
  runOfflineLab: (args) => ipcRenderer.invoke('projectHub:runOfflineLab', args),
  read: (id) => ipcRenderer.invoke('projectHub:read',id),
  previewNativePlan: (args) => ipcRenderer.invoke('projectHub:previewNativePlan', args),
  stageNativePlan: (args) => ipcRenderer.invoke('projectHub:stageNativePlan', args),
  inspectStagedNativePlan: (args) => ipcRenderer.invoke('projectHub:inspectStagedNativePlan', args),
  inspectWorkerDispatches: (args) => ipcRenderer.invoke('projectHub:inspectWorkerDispatches', args),
  save: (args) => ipcRenderer.invoke('projectHub:save',args)
}
