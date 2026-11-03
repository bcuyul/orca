/** Human-attested Atlas → external Forge → QA workflow. NEVER launches agents or grants host authority. */
import { useMemo, useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  emptyHubIntelligence, isHubIntelligence,
  type HubImplementationEvidence, type HubQualityReview
} from '../../../../shared/project-hub-intelligence'
import {
  projectHubHandoffReadiness, type HubHandoffStage
} from '../../../../shared/project-hub-handoff-readiness'
import {
  renderForgeImplementationPrompt, renderQaReviewPrompt
} from '../../../../shared/project-hub-intelligence-prompts'
import { createBrowserUuid } from '@/lib/browser-uuid'

type Props = { doc: HubDocument; busy: boolean; onSave: (next: HubDocument) => Promise<boolean> }
const field = 'w-full rounded border border-border bg-background p-2 text-xs'
const button = 'rounded border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'
const stamp = (): string => new Date().toISOString()
const newId = (prefix: string): string => `${prefix}-${createBrowserUuid().replaceAll('-', '')}`
const sha = /^[a-f0-9]{40}$/i
const workingRoles = new Set(['forge', 'flow', 'data'])
const labels: Record<HubHandoffStage,string> = {
  plan_not_accepted: 'Plan sin aprobación',
  role_only: 'Rol de planificación/QA, sin ejecución',
  awaiting_external_delivery: 'Entrega externa pendiente',
  awaiting_qa: 'Pendiente de QA independiente',
  changes_requested: 'QA solicita correcciones (declarado)',
  qa_inconclusive: 'QA inconcluso (declarado)',
  qa_approved_attested: 'QA aprobó (declarado; CI no verificado)',
  blocked: 'Bloqueado; requiere replanificación'
}

export default function ProjectHubHandoffPanel({ doc, busy, onSave }: Props): React.JSX.Element {
  const state = doc.intelligence ?? emptyHubIntelligence()
  const [planId, setPlanId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [actor, setActor] = useState('Forge CLI')
  const [baseSha, setBaseSha] = useState('')
  const [headSha, setHeadSha] = useState('')
  const [evidenceRef, setEvidenceRef] = useState('')
  const [testSummary, setTestSummary] = useState('')
  const [reviewReportId, setReviewReportId] = useState('')
  const [reviewer, setReviewer] = useState('QA independiente')
  const [qaEvidence, setQaEvidence] = useState('')
  const [qaFindings, setQaFindings] = useState('')
  const [verdict, setVerdict] = useState<HubQualityReview['verdict']>('inconclusive')
  const [notice, setNotice] = useState('')

  const plan = state.plans.find(p => p.id === planId)
  const task = plan?.tasks.find(t => t.id === taskId)
  const readiness = useMemo(
    () => plan ? projectHubHandoffReadiness(state, plan.id) : null,
    [state, plan?.id]
  )
  // Only one selected plan and a maximum of 20 tasks are rendered, not all
  // 30×20 possible cards on every keystroke.
  const reports = (state.implementations ?? []).filter(r =>
    r.planId === planId && r.taskId === taskId)
  const latest = reports.at(-1)
  const selectedReport = reports.find(r => r.id === reviewReportId)
  const canHandoff = readiness?.approvedByHuman === true &&
    !!task && workingRoles.has(task.role) &&
    readiness.tasks.find(t => t.id === taskId)?.stage !== 'blocked'
  const canRecord = canHandoff && !busy && (state.implementations?.length ?? 0) < 100 &&
    actor.trim().length >= 5 && actor.length <= 80 &&
    sha.test(baseSha) && sha.test(headSha) && evidenceRef.trim().length >= 5 &&
    testSummary.trim().length >= 5
  const canReview = !busy && !!selectedReport &&
    reviewer.trim().length >= 5 && reviewer.trim().toLocaleLowerCase('en') !==
      selectedReport?.executorLabel.trim().toLocaleLowerCase('en') &&
    qaEvidence.trim().length >= 5 && qaFindings.trim().length >= 5

  async function saveIntelligence(next: typeof state, message: string): Promise<boolean> {
    if (!isHubIntelligence(next)) {
      setNotice('Registro rechazado: plan, SHA, linaje o evidencia inválidos.')
      return false
    }
    const ok = await onSave({ ...doc, intelligence: next })
    setNotice(ok ? message : 'Guardado rechazado; recarga el proyecto para reconciliar revisiones.')
    return ok
  }
  async function copyPrompt(text: string): Promise<void> {
    try {
      await window.api.ui.writeClipboardText(text)
      setNotice('Encargo copiado. No se inició ningún agente ni se concedieron permisos.')
    } catch {
      setNotice('No se pudo copiar el encargo.')
    }
  }
  async function recordDelivery(): Promise<void> {
    if (!plan || !task || !canRecord) { return }
    const item: HubImplementationEvidence = {
      id: newId('impl'), planId:plan.id, taskId:task.id,
      executor:'external-unverified', executorLabel:actor.trim(),
      baseSha:baseSha.trim().toLowerCase(), headSha:headSha.trim().toLowerCase(),
      evidenceRef:evidenceRef.trim(), testSummary:testSummary.trim(), createdAt:stamp(),
      ...(latest ? { previousImplementationId:latest.id } : {})
    }
    if (await saveIntelligence({
      ...state, implementations:[...(state.implementations ?? []),item]
    }, 'Entrega externa declarada; falta comprobar diff y CI mediante QA.')) {
      setReviewReportId(item.id)
      setHeadSha('');setEvidenceRef('');setTestSummary('')
    }
  }
  async function recordReview(): Promise<void> {
    if (!plan || !task || !selectedReport || !canReview) { return }
    const entry: HubQualityReview = {
      id:newId('review'), planId:plan.id,taskId:task.id,
      reviewer:'human', reviewerLabel:reviewer.trim(),
      implementationId:selectedReport.id,
      verdict, evidenceRef:qaEvidence.trim(), findings:qaFindings.trim(), createdAt:stamp()
    }
    if (await saveIntelligence({ ...state,reviews:[...state.reviews,entry] },
      'QA registrado como declaración humana para el commit indicado, no como CI verificado.')) {
      setQaEvidence('');setQaFindings('');setVerdict('inconclusive')
    }
  }

  return <section className="space-y-3 rounded-lg border border-border bg-card p-3" aria-label="Ruta Atlas Forge QA">
    <h4 className="text-sm font-semibold">Atlas → Forge → QA · Trazabilidad</h4>
    <p className="text-muted-foreground">Entregas y revisiones declaradas por personas. No hay
      ejecución automática, autenticación de agentes ni validación remota de CI.</p>
    <label className="block">Plan de Atlas para entregar
      <select className={field} aria-label="Plan para entrega Forge" value={planId}
        onChange={e=>{setPlanId(e.target.value);setTaskId('');setReviewReportId('')}} disabled={busy}>
        <option value="">Seleccionar plan</option>
        {state.plans.map(p=><option value={p.id} key={p.id}>{p.objective.slice(0,85)}</option>)}
      </select>
    </label>
    {readiness && <div className="rounded border border-border p-2" role="group" aria-label="Estado del DAG">
      <p className="font-medium">{readiness.approvedByHuman ? 'Plan aprobado manualmente' : 'Plan pendiente o rechazado'}</p>
      <p className="text-muted-foreground">{readiness.total} tareas · {readiness.awaitingDelivery} entregas pendientes · {readiness.awaitingQa} pendientes QA · {readiness.qaAttested} QA declarados · {readiness.blocked} bloqueos</p>
      <ul className="mt-2 space-y-1">{readiness.tasks.map(t=><li key={t.id} className="border-t border-border py-1">
        <strong>{t.id}</strong> · {t.title} ({t.role})
        <p className="text-muted-foreground">{labels[t.stage]}{t.implementation ? ` · commit ${t.implementation.headSha.slice(0,12)}` : ''}</p>
      </li>)}</ul>
      <p className="mt-2 font-medium">Ejecución: bloqueada. Ningún estado concede un grant.</p>
    </div>}
    <label className="block">Tarea de Forge/Flow/Data
      <select className={field} aria-label="Tarea para entrega Forge" value={taskId}
        disabled={busy || !readiness?.approvedByHuman}
        onChange={e=>{setTaskId(e.target.value);setReviewReportId('')}}>
        <option value="">Seleccionar tarea</option>
        {plan?.tasks.filter(t=>workingRoles.has(t.role)).map(t=><option key={t.id} value={t.id}>{t.id} · {t.title}</option>)}
      </select>
    </label>
    {task && <p className="text-muted-foreground">Aceptación: {task.acceptance}</p>}
    <label className="block">Ejecutor externo declarado (sin identidad verificada)
      <input className={field} aria-label="Ejecutor externo" value={actor}
        onChange={e=>setActor(e.target.value)} maxLength={80} disabled={busy}/>
    </label>
    <label className="block">SHA base (40 caracteres)
      <input className={field} aria-label="SHA base de Forge" value={baseSha}
        onChange={e=>setBaseSha(e.target.value)} maxLength={40} disabled={busy}/>
    </label>
    <button className={button} type="button" disabled={!canHandoff || !sha.test(baseSha) || busy}
      onClick={()=>plan&&task&&void copyPrompt(renderForgeImplementationPrompt(doc,plan,task.id,baseSha))}>
      Copiar encargo Forge (sin ejecutar)
    </button>
    <label className="block">SHA de la entrega externa (40 caracteres)
      <input className={field} aria-label="SHA de entrega Forge" value={headSha}
        onChange={e=>setHeadSha(e.target.value)} maxLength={40} disabled={busy}/>
    </label>
    <label className="block">Referencia del diff o artefacto (no verificada)
      <input className={field} aria-label="Evidencia de Forge" value={evidenceRef}
        onChange={e=>setEvidenceRef(e.target.value)} maxLength={600} disabled={busy}/>
    </label>
    <label className="block">Pruebas declaradas por el implementador
      <textarea className={field} aria-label="Pruebas de Forge" value={testSummary}
        onChange={e=>setTestSummary(e.target.value)} maxLength={1200} disabled={busy}/>
    </label>
    <button className={button} type="button" disabled={!canRecord} onClick={()=>void recordDelivery()}>
      Registrar entrega externa (declaración)
    </button>
    <div className="space-y-2 rounded border border-border p-2">
      <h5 className="font-semibold">QA independiente · revisión vinculada</h5>
      <label className="block">Entrega exacta que revisará QA
        <select className={field} aria-label="Entrega para QA" value={reviewReportId}
          onChange={e=>setReviewReportId(e.target.value)} disabled={busy || !reports.length}>
          <option value="">Seleccionar entrega</option>
          {reports.map(r=><option key={r.id} value={r.id}>
            {r.id} · {r.headSha.slice(0,12)}{r.id===latest?.id ? ' (más reciente)' : ' (anterior)'}
          </option>)}
        </select>
      </label>
      {selectedReport && <p className="break-all text-muted-foreground">
        Entrega de {selectedReport.executorLabel}: base {selectedReport.baseSha.slice(0,12)} →
        {selectedReport.headSha.slice(0,12)} · evidencia declarada: {selectedReport.evidenceRef}
      </p>}
      <label className="block">Revisor independiente declarado
        <input className={field} aria-label="Revisor de QA" value={reviewer}
          onChange={e=>setReviewer(e.target.value)} maxLength={80} disabled={busy}/>
      </label>
      <label className="block">Referencia de revisión (no verificada)
        <input className={field} aria-label="Evidencia de QA" value={qaEvidence}
          onChange={e=>setQaEvidence(e.target.value)} maxLength={600} disabled={busy}/>
      </label>
      <button className={button} type="button"
        disabled={!selectedReport || !plan || !task || qaEvidence.trim().length<5 || busy}
        onClick={()=>plan&&task&&selectedReport&&void copyPrompt(
          renderQaReviewPrompt(doc,plan,task.id,qaEvidence,selectedReport))}>
        Copiar encargo QA para esta entrega
      </button>
      <label className="block">Resultado QA declarado
        <select className={field} aria-label="Resultado QA de entrega" value={verdict}
          onChange={e=>setVerdict(e.target.value as HubQualityReview['verdict'])} disabled={busy}>
          <option value="inconclusive">Inconcluso</option>
          <option value="changes-requested">Solicitar correcciones</option>
          <option value="approved">Aprobación declarada (no CI verificado)</option>
        </select>
      </label>
      <label className="block">Hallazgos y comprobaciones
        <textarea className={field} aria-label="Hallazgos QA" value={qaFindings}
          onChange={e=>setQaFindings(e.target.value)} maxLength={2000} disabled={busy}/>
      </label>
      <button className={button} type="button" disabled={!canReview} onClick={()=>void recordReview()}>
        Registrar QA vinculado (declaración)
      </button>
      <p className="text-muted-foreground">Cambiar el commit exige otra entrega; una revisión anterior no aprueba la nueva.</p>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>
}
