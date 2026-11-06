/** Explicit user action opens an editable native chat draft; Coordinator remains blocked. */
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { readHubLocalSessionInventory } from '@/lib/project-hub-host-session-reader'
import { activateStructuredAgentSessionTab } from '@/lib/agent-session/structured-agent-session-tab-activation'

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
  const [pendingSession, setPendingSession] = useState<{ sessionId: string; agent: TuiAgent; worktreeId: string } | null>(null)
  const [launchPending, setLaunchPending] = useState(false)
  const [launchUncertain, setLaunchUncertain] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const operationEpoch = useRef(0)
  const launchLocked = useRef(false)
  const inventories = useAppStore(s => s.localDetectedAgentIdsByContext)
  const detecting = useAppStore(s => s.isDetectingLocalAgentsByContext)
  const refreshing = useAppStore(s => s.isRefreshingLocalAgentsByContext)
  const disabled = useAppStore(s => s.settings?.disabledTuiAgents)
  const worktreeId = gitContext?.worktreeId ?? ''
  const worktreePath = gitContext?.worktreePath ?? ''
  const hostId = gitContext?.hostId ?? ''
  const local = hostId === 'local' && Boolean(worktreeId && worktreePath)
  useEffect(() => {
    if (local) { void useAppStore.getState().ensureDetectedAgents(worktreeId) }
  }, [local, worktreeId])
  useEffect(() => {
    operationEpoch.current += 1
    launchLocked.current = false
    setConfirmed(false)
    setPendingSession(null)
    setLaunchPending(false)
    setLaunchUncertain(false)
    setSessionBusy(false)
  }, [doc.projectId, doc.revision, worktreeId, hostId])
  const inventory = useMemo(() => {
    // These store slices notify React when host detection changes.
    void inventories; void detecting; void refreshing
    return local
      ? useAppStore.getState().readLocalAgentInventory(worktreeId)
      : { ids: null, state: 'unsupported-host' as const }
  }, [local, worktreeId, inventories, detecting, refreshing])
  const available = previewNativeAgentRouting(doc, inventory.state, inventory.ids, disabled ?? [])
    .installedAgents
  const plans = doc.intelligence?.plans ?? []
  const plan = plans.find(p => p.id === planId)
  const tasks = plan?.tasks.filter(t => ['forge', 'flow', 'data'].includes(t.role)) ?? []
  const reports = (doc.intelligence?.implementations ?? []).filter(r =>
    r.planId === planId && r.taskId === taskId)
  const lastReport = reports.at(-1)
  const target = useMemo<HubNativeTarget>(() => kind === 'atlas'
    ? { kind, ...(blockerId ? { blockerId } : {}) }
    : kind === 'forge'
      ? { kind, planId, taskId, baseSha }
      : { kind, planId, taskId, reportId },
  [kind, blockerId, planId, taskId, baseSha, reportId])
  const draft = useMemo(() => {
    try { return buildHubNativeDraft(doc, target) }
    catch { return null }
  }, [doc, target])

  async function readBase(): Promise<void> {
    if (!local || !gitContext || reading) { return }
    setReading(true)
    try {
      const [status, history] = await Promise.all([
        window.api.git.status({
          worktreePath, admissionTier: 'interactive',
          wakeWslDistro: false
        }),
        window.api.git.history({
          worktreePath, limit: 1, wakeWslDistro: false
        })
      ])
      setBaseSha(projectHubLocalGitSnapshot(status, history).headSha)
      setConfirmed(false)
      setNotice('SHA local capturado: no acredita ejecución ni permisos.')
    } catch (error) {
      setNotice(`Git no disponible o sin HEAD limpio: ${String(error)}`)
    } finally { setReading(false) }
  }
  function openDraft(): void {
    if (!local || !gitContext || !confirmed || !draft || !agent ||
      !available.includes(agent) || reading || launchUncertain ||
      pendingSession !== null || launchLocked.current) { return }
    const store = useAppStore.getState()
    if (gitContext.hostId !== 'local' ||
      gitContext.worktreePath !== worktreePath ||
      store.activeWorktreeId !== worktreeId ||
      !structuredAgentSessionLaunchFeasible(store, {
        agent, workspace: worktreeLaunchWorkspace(worktreeId), settings: store.settings
      })) {
      setNotice('Host, worktree o chat nativo no habilitado; no se abrió sesión.')
      return
    }
    const epoch = operationEpoch.current
    const launchedAgent = agent
    launchLocked.current = true
    setLaunchPending(true)
    setPendingSession(null)
    const finish = (): void => {
      if (epoch !== operationEpoch.current) { return }
      launchLocked.current = false
      setLaunchPending(false)
    }
    try {
      const result = launchAgentInNewTab({
        requestId: newAgentLaunchRequestId(), agent: launchedAgent,
        worktreeId, requestedSurface: 'chat',
        prompt: draft.prompt, promptDelivery: 'draft',
        onStructuredHostDeclined: () => ({ opened: false })
      })
      if (!result) {
        finish()
        setNotice('El host rechazó preparar el borrador nativo.')
        return
      }
      if (!result.structuredSettlement) {
        finish()
        setLaunchUncertain(true)
        setNotice('Chat solicitado sin recibo verificable. Comprueba el estado en Orca antes de crear otro.')
        return
      }
      setNotice('Solicitud enviada al host. El borrador no se envía automáticamente.')
      void result.structuredSettlement.then(outcome => {
        if (epoch !== operationEpoch.current) { return }
        finish()
        if (outcome.kind === 'structured' &&
          useAppStore.getState().activeWorktreeId === worktreeId) {
          setPendingSession({ sessionId: outcome.sessionId, agent: launchedAgent, worktreeId })
          setNotice('Host confirmó un chat. Puedes comprobar su identidad y abrirlo; no acredita trabajo terminado.')
        } else if (outcome.kind === 'visibility-unknown') {
          setPendingSession({ sessionId: outcome.sessionId, agent: launchedAgent, worktreeId })
          setLaunchUncertain(true)
          setNotice('El estado del chat es incierto. Puedes consultar el inventario; no se crea otra sesión.')
        } else {
          setNotice('El host no confirmó una sesión nativa utilizable. No se envió el encargo desde Project Hub.')
        }
      }).catch(() => {
        if (epoch !== operationEpoch.current) { return }
        finish()
        setLaunchUncertain(true)
        setNotice('No se pudo verificar el lanzamiento. Comprueba Orca; no se reintentará automáticamente.')
      })
    } catch {
      finish()
      setLaunchUncertain(true)
      setNotice('No se conoce el resultado del lanzamiento. No se reintentará automáticamente.')
    }
  }

  async function openConfirmedSession(): Promise<void> {
    const candidate = pendingSession
    if (!local || !candidate || sessionBusy || launchLocked.current ||
      candidate.worktreeId !== worktreeId ||
      useAppStore.getState().activeWorktreeId !== worktreeId) { return }
    const epoch = operationEpoch.current
    setSessionBusy(true)
    try {
      // Read-only host inventory. Do not call tab repair/reveal (side effects).
      const decision = await readHubLocalSessionInventory(candidate)
      if (epoch !== operationEpoch.current ||
        useAppStore.getState().activeWorktreeId !== worktreeId) { return }
      if (decision.kind !== 'confirmed') {
        setNotice(`Chat no conciliado: ${decision.reason}. No se reenviará ningún prompt.`)
        return
      }
      if (!activateStructuredAgentSessionTab({
        worktreeId, tabId: decision.tabId, target: { kind: 'local' }
      })) {
        setNotice('El host reconoce el chat, pero su pestaña no está publicada en esta ventana.')
        return
      }
      setLaunchUncertain(false)
      setNotice('Chat abierto. Sigue siendo un borrador; no hay Dispatch ni QA verificada.')
    } catch {
      if (epoch === operationEpoch.current) {
        setNotice('No fue posible conciliar el chat. No se creará otro automáticamente.')
      }
    } finally {
      if (epoch === operationEpoch.current) { setSessionBusy(false) }
    }
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
        disabled={!confirmed || !local || !draft || !agent || !available.includes(agent) || reading || launchPending || sessionBusy || launchUncertain || pendingSession !== null}
        onClick={openDraft}>Abrir borrador en chat nativo</button>
      {pendingSession && <button type="button" className={button}
        disabled={!local || launchPending || sessionBusy || reading}
        onClick={() => void openConfirmedSession()}>Comprobar y abrir chat existente</button>}
      <button type="button" className={button} disabled>Coordinator: ejecución bloqueada</button>
    </div>
    <p className="text-muted-foreground">
      No se crean Run, Task, Dispatch, worktrees ni permisos adicionales.
      QA y Git siguen siendo declaraciones hasta una verificación independiente.
      La conciliación del host solo habilita navegación, nunca ejecución.
      Los lanzamientos sin recibo permanecen bloqueados hasta una conciliación externa.
    </p>
    {notice && <p role="status">{notice}</p>}
  </section>
}
