import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../shared/execution-host'
import { parseRuntimeWorktreeId } from '../runtime/runtime-worktree-path-identity'
import { projectHostSetupProjectionFromRepos } from '../../shared/project-host-setup-projection'
import { resolveHubProjectId } from '../../shared/project-hub-project-id'
import { projectHubLocalGitSnapshot } from '../../shared/project-hub-git-assist'
import { stageHubNativePlan } from '../project-hub/supervised-native-plan-stage'
import { inspectHubNativeStages } from '../project-hub/native-stage-recovery'
import { isHubStageNativePlanRequest, type HubStageNativePlanRequest } from '../../shared/project-hub-supervised-stage'
import type { Store } from '../persistence/loading-store/store'
import { getProjectIdentityKey } from '../../shared/project-host-setup-projection'
import { isHubDocument } from '../../shared/project-hub-types'
import { ProjectHubStore } from '../project-hub/project-hub-store'
import { buildNativePlanPreview } from '../project-hub/native-plan-preview'

let trustedWindowId: number | null = null

/** Refresh on desktop window recreation; never retain a stale renderer authority. */
export function setTrustedProjectHubRenderer(id: number | null): void { trustedWindowId = id }

export function registerProjectHubHandlers(store: Store, runtime: OrcaRuntimeService): void {
  const db = new ProjectHubStore(app.getPath('userData'))
  const authorize = (sender: number, projectId: unknown): string => {
    if(trustedWindowId===null || sender!==trustedWindowId) throw new Error('Project Hub requires trusted desktop window')
    if(typeof projectId!=='string'||!projectId||projectId.length>500) throw new Error('Invalid Project.id')
    const known = store.getProjects().some(p=>p.id===projectId) ||
      store.getRepos().some(r=>getProjectIdentityKey(r)===projectId)
    if(!known) throw new Error('Project not registered in Orca')
    return projectId
  }
  ipcMain.handle('projectHub:read',(event,projectId: unknown)=>db.read(authorize(event.sender.id,projectId)))
  ipcMain.handle('projectHub:save',(event,args: unknown)=>{
    if(!args||typeof args!=='object'||Array.isArray(args)) throw new Error('Invalid request')
    const data=args as Record<string,unknown>
    const id=authorize(event.sender.id,data.projectId)
    if(!isHubDocument(data.document)) throw new Error('Invalid document')
    return db.save(id,data.document,data.expectedRevision as number)
  })
  // Read-only host projection; no grant, Run, Task, Dispatch or CLI creation.
  ipcMain.handle('projectHub:previewNativePlan', (event, args: unknown) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('Invalid preview request')
    }
    const data = args as Record<string, unknown>
    const projectId = authorize(event.sender.id, data.projectId)
    if (typeof data.planId !== 'string' || !Number.isSafeInteger(data.expectedRevision)) {
      throw new Error('Invalid preview arguments')
    }
    return buildNativePlanPreview(db.read(projectId), data.planId, data.expectedRevision as number)
  })
  /** Verify catalog ownership without requiring a clean or unchanged Git HEAD.
   * Recovery must remain available after a commit, dirty worktree or app restart.
   */
  const localHubWorktree = (projectId: string, worktreeId: string) => {
    const parsed = parseRuntimeWorktreeId(worktreeId)
    if (!parsed) { throw new Error('Invalid registered Git worktree identity') }
    const repo = store.getRepo(parsed.repoId)
    if (!repo || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
      throw new Error('Only a locally registered repository may access native Run state')
    }
    const projection = projectHostSetupProjectionFromRepos(store.getRepos())
    const resolvedProjectId = resolveHubProjectId({
      repoId: parsed.repoId, hostId: LOCAL_EXECUTION_HOST_ID,
      projects: [...store.getProjects(), ...projection.projects],
      setups: projection.setups, fallback: getProjectIdentityKey(repo)
    })
    if (resolvedProjectId !== projectId) {
      throw new Error('Worktree is not owned by the selected Project Hub project')
    }
    return {
      worktreeId, repoId: parsed.repoId, projectId,
      hostId: LOCAL_EXECUTION_HOST_ID
    }
  }
  // A host-native dialog is the approval boundary; no renderer boolean grants
  // orchestration authority. Only quarantined Run/Task rows may be written here.
  let stageInFlight = false
  ipcMain.handle('projectHub:stageNativePlan', async (event, raw: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame ||
        !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid supervised stage origin')
    }
    const request = raw as HubStageNativePlanRequest
    const projectId = authorize(event.sender.id, request.projectId)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || window.webContents.id !== trustedWindowId) {
      throw new Error('Supervised staging requires the current trusted Orca window')
    }
    if (stageInFlight) { throw new Error('Another supervised stage is still in progress') }
    stageInFlight = true
    try {
      return await stageHubNativePlan(request, {
        readProject: (id) => db.read(authorize(event.sender.id, id)),
        getOrchestrationDb: () => runtime.getOrchestrationDb(),
        inspectWorktree: async (worktreeId) => {
          const identity = localHubWorktree(projectId, worktreeId)
          const selector = 'id:' + worktreeId
          const [status, history] = await Promise.all([
            runtime.getRuntimeGitStatus(selector),
            runtime.getRuntimeGitHistory(selector, { limit: 1 })
          ])
          const git = projectHubLocalGitSnapshot(status, history)
          return { ...identity, baseSha: git.headSha }
        },
        confirmInHostWindow: async ({ preview, worktree }) => {
          if (window.isDestroyed() || window.webContents.id !== trustedWindowId) {
            return false
          }
          const answer = await dialog.showMessageBox(window, {
            type: 'warning', title: 'Project Hub — Run/Task supervisado',
            message: '¿Crear un Run y tareas nativas para este plan aprobado?',
            detail: [
              `Plan: ${preview.objective.slice(0, 160)}`,
              `Tareas: ${preview.tasks.length} · Proyecto: ${projectId.slice(0, 160)}`,
              `Worktree: ${worktree.worktreeId.slice(0, 160)}`,
              `HEAD Git: ${worktree.baseSha}`,
              'NO inicia agentes, terminales, OpenCode, QA ni Dispatch.',
              'Se requiere otra aprobación para ejecutar una tarea.'
            ].join('\n'),
            buttons: ['Cancelar', 'Crear Run/Task sin ejecutar'],
            defaultId: 0, cancelId: 0, noLink: true
          })
          return answer.response === 1 && !window.isDestroyed() &&
            window.webContents.id === trustedWindowId
        }
      })
    } finally { stageInFlight = false }
  })

  // Read-only recovery; no Git cleanliness required, no host scope creation.
  ipcMain.handle('projectHub:inspectStagedNativePlan', (event, raw: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame ||
        !isHubStageNativePlanRequest(raw)) {
      throw new Error('Invalid native Run inspection origin or request')
    }
    const projectId = authorize(event.sender.id, raw.projectId)
    const ownership = localHubWorktree(projectId, raw.worktreeId)
    const preview = buildNativePlanPreview(db.read(projectId), raw.planId, raw.expectedRevision)
    if (preview.planSha !== raw.planSha) {
      throw new Error('Stale Project Hub plan; reload before inspection')
    }
    return inspectHubNativeStages(runtime.getOrchestrationDb(), preview, ownership)
  })

}
