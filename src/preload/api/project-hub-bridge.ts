import { ipcRenderer } from 'electron'
import type { ProjectHubApi } from './project-hub-api'
export const projectHubApi: ProjectHubApi = {
  read: (id) => ipcRenderer.invoke('projectHub:read',id),
  previewNativePlan: (args) => ipcRenderer.invoke('projectHub:previewNativePlan', args),
  save: (args) => ipcRenderer.invoke('projectHub:save',args)
}
