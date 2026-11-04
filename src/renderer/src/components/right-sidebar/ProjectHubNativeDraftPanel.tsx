/** Explicit user action opens an editable native chat draft; Coordinator remains blocked. */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { structuredAgentSessionLaunchFeasible } from '@/lib/agent-session-launch-plan'
import { worktreeLaunchWorkspace } from '@/lib/agent-launch-route-input'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { HubDocument } from '../../../../shared/project-hub-types'
import { buildHubNativeDraft, type HubNativeTarget } from '../../../../shared/project-hub-native-draft'
import { previewNativeAgentRouting } from '../../../../shared/project-hub-native-agent-routing'
import { projectHubLocalGitSnapshot } from '../../../../shared/project-hub-git-assist'

type Props = { doc: HubDocument; gitContext?: {
  worktreeId: string; worktreePath: string; hostId: string
} }
const field = 'w-full rounded border border-border bg-background p-2 text-xs'
const button = 'rounded border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'

export default function ProjectHubNativeDraftPanel({ doc, gitContext }: Props): React.JSX.Element {
  const [kind, setKind] = useState<HubNativeTarget['kind']>('atlas')
  const [agent, setAgent] = useState<TuiAgent | ''>('')
  const [planId, setPlanId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [reportId, setReportId] = useState('')
  const [blockerId, setBlockerId] = useState('')
  const [baseSha, setBaseSha] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  const inventories = useAppStore(s => s.localDetectedAgentIdsByContext)
  const detecting = useAppStore(s => s.isDetectingLocalAgentsByContext)
  const refreshing = useAppStore(s => s.isRefreshingLocalAgentsByContext)
  const disabled = useAppStore(s => s.settings?.disabledTuiAgents)
  const local = gitContext?.hostId === 'local' &&
    Boolean(gitContext.worktreeId && gitContext.worktreePath)
  useEffect(() => {
    if (local && gitContext) {
      void useAppStore.getState().ensureDetectedAgents(gitContext.worktreeId)
    }
  }, [local, gitContext?.worktreeId])
  const inventory = useMemo(() => local && gitContext
    ? useAppStore.getState().readLocalAgentInventory(gitContext.worktreeId)
    : { ids: null, state: 'unsupported-host' as const },
  [local, gitContext?.worktreeId, inventories, detecting, refreshing])
  const available = previewNativeAgentRouting(doc, inventory.state, inventory.ids, disabled ?? [])
    .installedAgents
  const plans = doc.intelligence?.plans ?? []
  const plan = plans.find(p => p.id === planId)
  const tasks = plan?.tasks.filter(t => ['forge', 'flow', 'data'].includes(t.role)) ?? []
  const reports = (doc.intelligence?.implementations ?? []).filter(r =>
    r.planId === planId && r.taskId === taskId)
  const lastReport = reports.at(-1)
  const target: HubNativeTarget = kind === 'atlas'
    ? { kind, ...(blockerId ? { blockerId } : {}) }
    : kind === 'forge'
      ? { kind, planId, taskId, baseSha }
      : { kind, planId, taskId, reportId }
  const draft = useMemo(() => {
    try { return buildHubNativeDraft(doc, target) }
    catch { return null }
  }, [doc, kind, blockerId, planId, taskId, baseSha, reportId])

  async function readBase(): Promise<void> {
    if (!local || !gitContext || reading) { return }
    setReading(true)
    try {
      const [status, history] = await Promise.all([
        window.api.git.status({
          worktreePath: gitContext.worktreePath, admissionTier: 'interactive',
          wakeWslDistro: false
        }),
        window.api.git.history({
          worktreePath: gitContext.worktreePath, limit: 1, wakeWslDistro: false
        })
      ])
      setBaseSha(projectHubLocalGitSnapshot(status, history).headSha)
      setConfirmed(false)
      setNotice('SHA local capturado: no acredita ejecución ni permisos.')
    } catch (error) {
      setNotice('Git no disponible o sin HEAD limpio: ' + String(error))
    } finally { setReading(false) }
  }
  function openDraft(): void {
    if (!local || !gitContext || !confirmed || !draft || !agent ||
      !available.includes(agent) || reading) { return }
    const store = useAppStore.getState()
    if (store.activeWorktreeId !== gitContext.worktreeId ||
      !structuredAgentSessionLaunchFeasible(store, {
        agent, workspace: worktreeLaunchWorkspace(gitContext.worktreeId),
        settings: store.settings
      })) {
      setNotice('Host, worktree o chat nativo no habilitado; no se abrió sesión.')
      return
    }
    try {
      const result = launchAgentInNewTab({
        requestId: newAgentLaunchRequestId(), agent,
        worktreeId: gitContext.worktreeId, requestedSurface: 'chat',
        prompt: draft.prompt, promptDelivery: 'draft',
        onStructuredHostDeclined: () => ({ opened: false })
      })
      if (!result) {
        setNotice('El host rechazó preparar el borrador nativo.')
        return
      }
      setNotice('Borrador solicitado. Revisa y envía desde el chat: no hay autoenvío ni Dispatch.')
      void result.structuredSettlement?.then(outcome => {
        if (outcome.kind === 'failed' || outcome.kind === 'cancelled') {
          setNotice('El host no confirmó la sesión nativa. No se envió un encargo desde Project Hub.')
        }
      }).catch(error => setNotice('Error de chat nativo: ' + String(error)))
    } catch (error) { setNotice('Error al abrir el borrador: ' + String(error)) }
  }
  return <section className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs"
    aria-label="Project Hub borrador en chat nativo">
    <h4 className="text-sm font-semibold">Atlas → Forge → QA · Borrador nativo</h4>
    <p className="text-muted-foreground">
      Abre un chat nuevo con el encargo editable, sin portapapeles ni envío automático.
      Tu sesión conserva los permisos propios de Orca.
    </p>
    <label className="block">Rol del encargo
      <select className={field} value={kind} onChange={e => {
        setKind(e.target.value as HubNativeTarget['kind']); setConfirmed(false)
      }}>
        <option value="atlas">Atlas · planificar</option>
        <option value="forge">Forge / Flow / Data · implementar</option>
        <option value="qa">QA · revisar entrega</option>
      </select>
    </label>
    {kind === 'atlas' && <label className="block">Replanificación
      <select className={field} value={blockerId} onChange={e => {
        setBlockerId(e.target.value); setConfirmed(false)
      }}>
        <option value="">Plan inicial</option>
        {(doc.intelligence?.blockers ?? []).map(b =>
          <option key={b.id} value={b.id}>{b.taskId} · {b.observation.slice(0, 60)}</option>)}
      </select>
    </label>}
    {kind !== 'atlas' && <>
      <label className="block">Plan aprobado
        <select className={field} value={planId} onChange={e => {
          setPlanId(e.target.value); setTaskId(''); setReportId(''); setConfirmed(false)
        }}>
          <option value="">Seleccionar plan</option>
          {plans.filter(p => doc.intelligence?.decisions.some(d =>
            d.subject === 'plan' && d.subjectId === p.id && d.verdict === 'accepted'
          )).map(p => <option key={p.id} value={p.id}>{p.objective.slice(0, 75)}</option>)}
        </select>
      </label>
      <label className="block">Tarea
        <select className={field} value={taskId} onChange={e => {
          setTaskId(e.target.value); setReportId(''); setConfirmed(false)
        }}>
          <option value="">Seleccionar tarea</option>
          {tasks.map(t => <option key={t.id} value={t.id}>{t.id} · {t.title.slice(0, 60)}</option>)}
        </select>
      </label>
    </>}
    {kind === 'forge' && <>
      <label className="block">SHA base (editable, sin autoridad de ejecución)
        <input className={field} value={baseSha} maxLength={40}
          onChange={e => { setBaseSha(e.target.value); setConfirmed(false) }}/>
      </label>
      <button type="button" className={button} disabled={!local || reading}
        onClick={() => void readBase()}>Leer SHA base desde Git local</button>
    </>}
    {kind === 'qa' && <label className="block">Última entrega declarada
      <select className={field} value={reportId} disabled={!lastReport}
        onChange={e => { setReportId(e.target.value); setConfirmed(false) }}>
        <option value="">Seleccionar entrega</option>
        {lastReport && <option value={lastReport.id}>
          {lastReport.id} · {lastReport.headSha.slice(0, 12)} (no verificado)
        </option>}
      </select>
    </label>}
    <label className="block">Agente detectado
      <select className={field} value={agent} disabled={!local || !available.length}
        onChange={e => { setAgent(e.target.value as TuiAgent | ''); setConfirmed(false) }}>
        <option value="">Seleccionar agente</option>
        {available.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    </label>
    {!local && <p role="alert">Host remoto: conserva el modo manual existente.</p>}
    <label className="block">Vista previa (editable al abrir el chat)
      <textarea className={field} aria-label="Borrador preparado" rows={5} readOnly
        value={draft?.prompt ?? ''}/>
    </label>
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={confirmed}
        onChange={e => setConfirmed(e.target.checked)}/>
      Revisé el encargo y autorizo abrir un borrador, sin enviarlo
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button}
        disabled={!confirmed || !local || !draft || !agent || !available.includes(agent) || reading}
        onClick={openDraft}>Abrir borrador en chat nativo</button>
      <button type="button" className={button} disabled>Coordinator: ejecución bloqueada</button>
    </div>
    <p className="text-muted-foreground">
      No se crean Run, Task, Dispatch, worktrees ni permisos adicionales.
      QA y Git siguen siendo declaraciones hasta una verificación independiente.
    </p>
    {notice && <p role="status">{notice}</p>}
  </section>
}
