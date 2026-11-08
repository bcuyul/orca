/** Human-gated records; native draft creation requires a separate explicit action. */
import { useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import type { NativePlanPreview } from '../../../../shared/native-plan-preview'
import type { HubStagedNativePlan, HubNativeStageRecovery } from '../../../../shared/project-hub-supervised-stage'
import {
  emptyHubIntelligence, isHubIntelligence, approvedHubMemories,
  type HubIntelligence, type HubHumanDecision, type HubBlocker,
  type HubMemoryCandidate, type HubQualityReview, type HubPlanProposal
} from '../../../../shared/project-hub-intelligence'
import {
  parseAtlasPlanJson, renderAtlasPlanningPrompt, renderQaReviewPrompt
} from '../../../../shared/project-hub-intelligence-prompts'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { HUB_AGENT_PROFILES, type HubAgentProfile } from '../../../../shared/project-hub-agent-profiles'
import { approvedHubTaskLessons } from '../../../../shared/project-hub-task-memory'
import ProjectHubHandoffPanel from './ProjectHubHandoffPanel'
import ProjectHubNativeDraftPanel from './ProjectHubNativeDraftPanel'

type Props = {
  doc: HubDocument
  busy: boolean
  onSave: (next: HubDocument) => Promise<boolean>
  gitContext?: { worktreeId: string; worktreePath: string; hostId: string }
}
const field = 'w-full rounded border border-border bg-background p-2 text-xs'
const action = 'rounded border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'
const stamp = (): string => new Date().toISOString()
const newId = (prefix: string): string => `${prefix}-${createBrowserUuid().replaceAll('-', '')}`

const planLabel = (plan: HubPlanProposal): string =>
  `${plan.objective.slice(0, 85)} · ${plan.previousPlanId ? 'Replanificación' : 'Plan inicial'} · ${plan.tasks.length} tareas`

type DecisionEditorProps = {
  subject: HubHumanDecision['subject']
  subjectId: string
  busy: boolean
  mode?: 'decide' | 'revoke'
  onDecide: (subject: HubHumanDecision['subject'], subjectId: string, verdict: HubHumanDecision['verdict'], justification: string) => Promise<boolean>
}

/** Keep each approval's justification beside its target. Never silently authorize execution. */
function DecisionEditor({ subject, subjectId, busy, onDecide, mode = 'decide' }: DecisionEditorProps): React.JSX.Element {
  const [justification, setJustification] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const eligible = !busy && confirmed && justification.trim().length >= 5
  const noun = subject === 'plan' ? 'plan' : 'aprendizaje'
  return <div className="mt-2 space-y-2 rounded border border-border p-2">
    <label className="block">{mode === 'revoke' ? 'Motivo de revocación' : `Justificación de la decisión sobre este ${noun}`}
      <textarea className={field} rows={2} value={justification} disabled={busy} maxLength={1000}
        onChange={e => setJustification(e.target.value)} placeholder="Qué evidencia revisaste y por qué decides esto"/>
    </label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy}
      onChange={e => setConfirmed(e.target.checked)}/>
      {mode === 'revoke' ? 'Confirmo que esta lección ya no debe reutilizarse. Su historial se conserva' : 'Confirmo que revisé esta propuesta. La decisión no ejecuta agentes ni verifica CI'}
    </label>
    <div className="flex flex-wrap gap-2">
      {mode === 'revoke' ? <button className={action} type="button" disabled={!eligible}
        onClick={() => void onDecide(subject, subjectId, 'revoked', justification)}>
        Revocar aprendizaje
      </button> : <>
        <button className={action} type="button" disabled={!eligible}
          onClick={() => void onDecide(subject, subjectId, 'accepted', justification)}>
          Aprobar {noun}
        </button>
        <button className={action} type="button" disabled={!eligible}
          onClick={() => void onDecide(subject, subjectId, 'rejected', justification)}>
          Rechazar {noun}
        </button>
      </>}
    </div>
  </div>
}

export default function ProjectHubIntelligencePanel({ doc, busy, onSave, gitContext }: Props): React.JSX.Element {
  const state = doc.intelligence ?? emptyHubIntelligence()
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<NativePlanPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recovery, setRecovery] = useState<{
    projectId: string; revision: number; planSha: string; worktreeId: string;
    result: HubNativeStageRecovery
  } | null>(null)
  const [stageBusy, setStageBusy] = useState(false)
  const [staged, setStaged] = useState<{revision: number; receipt: HubStagedNativePlan} | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [rawPlan, setRawPlan] = useState('')
  const [blockerForReplan, setBlockerForReplan] = useState('')
  const [planForBlocker, setPlanForBlocker] = useState('')
  const [taskForBlocker, setTaskForBlocker] = useState('')
  const [observation, setObservation] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [lesson, setLesson] = useState('')
  const [applicability, setApplicability] = useState('')
  const [memoryProfile, setMemoryProfile] = useState<HubAgentProfile | 'all'>('forge')
  const [memoryEvidence, setMemoryEvidence] = useState('')
  const [qaPlan, setQaPlan] = useState('')
  const [qaTask, setQaTask] = useState('')
  const [qaEvidence, setQaEvidence] = useState('')
  const [qaFindings, setQaFindings] = useState('')
  const [qaVerdict, setQaVerdict] = useState<HubQualityReview['verdict']>('inconclusive')

  const chosenBlocker = state.blockers.find(b => b.id === blockerForReplan)
  const previous = state.plans.find(p => p.id === chosenBlocker?.planId)
  const blockPlan = state.plans.find(p => p.id === planForBlocker)
  const reviewPlan = state.plans.find(p => p.id === qaPlan)
  const decisions = new Map(state.decisions.map(d => [`${d.subject}:${d.subjectId}`, d] as const))
  const memoryTags = applicability.split(',').map(tag => tag.trim().toLowerCase())
  const memoryTagsValid = memoryTags.length >= 1 && memoryTags.length <= 8 &&
    memoryTags.every(tag => /^[a-z0-9_-]{3,32}$/.test(tag)) &&
    new Set(memoryTags).size === memoryTags.length
  const reusableMemoryValid = lesson.trim().length >= 8 && lesson.trim().length <= 220 &&
    !/[<>]/.test(lesson) &&
    ![...lesson.trim()].some(char => char.charCodeAt(0) < 32) &&
    memoryTagsValid &&
    /^commit:[a-f0-9]{40}$/.test(memoryEvidence.trim())
  const eligibleMemoryCount = approvedHubTaskLessons(state, doc.projectId).length
  const currentPreview = preview?.projectId === doc.projectId && preview.revision === doc.revision ? preview : null
  const currentRecovery = currentPreview && recovery?.projectId === doc.projectId &&
    recovery.revision === doc.revision && recovery.planSha === currentPreview.planSha &&
    recovery.worktreeId === gitContext?.worktreeId ? recovery.result : null
  async function inspectNativeRecovery(fresh: NativePlanPreview): Promise<void> {
    if (!gitContext || gitContext.hostId !== 'local') {
      setRecovery(null)
      return
    }
    setRecoveryBusy(true)
    setRecoveryError('')
    try {
      const result = await window.api.projectHub.inspectStagedNativePlan({
        projectId: fresh.projectId, planId: fresh.planId,
        expectedRevision: fresh.revision, planSha: fresh.planSha,
        worktreeId: gitContext.worktreeId
      })
      setRecovery({
        projectId: fresh.projectId, revision: fresh.revision,
        planSha: fresh.planSha, worktreeId: gitContext.worktreeId, result
      })
    } catch (error) {
      setRecovery(null)
      setRecoveryError(String(error))
    } finally {
      setRecoveryBusy(false)
    }
  }
  async function persist(next: HubIntelligence, success: string): Promise<boolean> {
    if (!isHubIntelligence(next)) { setNotice('Registro inválido: revisa IDs, DAG y evidencia.'); return false }
    const ok = await onSave({ ...doc, intelligence: next })
    setNotice(ok ? success : 'No se pudo guardar; revisa el mensaje de Project Hub.')
    return ok
  }
  async function inspectNativePlan(planId: string): Promise<void> {
    setPreviewBusy(true)
    setPreviewError('')
    setRecovery(null)
    try {
      const response = await window.api.projectHub.previewNativePlan({
        projectId: doc.projectId, planId, expectedRevision: doc.revision
      })
      setPreview(response)
      await inspectNativeRecovery(response)
    } catch (error) {
      setPreview(null)
      setPreviewError(String(error))
    } finally {
      setPreviewBusy(false)
    }
  }
  async function stageNativePlan(preview: NativePlanPreview): Promise<void> {
    if (!gitContext || gitContext.hostId !== 'local' || stageBusy ||
        preview.projectId !== doc.projectId || preview.revision !== doc.revision ||
        preview.approval !== 'accepted') { return }
    setStageBusy(true)
    try {
      const result = await window.api.projectHub.stageNativePlan({
        projectId: doc.projectId, planId: preview.planId,
        expectedRevision: preview.revision, planSha: preview.planSha,
        worktreeId: gitContext.worktreeId
      })
      if (result.status === 'cancelled') {
        setNotice('Se canceló la materialización: no se creó ningún Run.')
      } else {
        setStaged({ revision: preview.revision, receipt: result })
        setNotice(result.reused
          ? 'Run existente reconciliado; no hay tareas duplicadas.'
          : 'Run y tareas nativos creados. El Dispatch sigue bloqueado.')
        await inspectNativeRecovery(preview)
      }
    } catch (error) {
      setNotice(`Materialización rechazada: ${String(error)}. No se lanzarán agentes.`)
    } finally { setStageBusy(false) }
  }
  async function copy(text: string): Promise<void> {
    try { await window.api.ui.writeClipboardText(text); setNotice('Encargo copiado. Revisa el contexto antes de entregarlo a un CLI.') }
    catch { setNotice('No se pudo copiar el encargo.') }
  }
  async function importPlan(): Promise<void> {
    try {
      const proposal = parseAtlasPlanJson(rawPlan, {
        id: newId('plan'), createdAt: stamp(),
        ...(previous && chosenBlocker ?
          { previousPlanId: previous.id, blockerId: chosenBlocker.id } : {})
      })
      if (await persist({ ...state, plans: [...state.plans, proposal] },
        'Propuesta DAG guardada; aún NO es un Run de Orca.')) {
        setRawPlan('')
        setBlockerForReplan('')
      }
    } catch (error) { setNotice(`Propuesta rechazada: ${String(error)}`) }
  }
  async function reportBlocker(): Promise<void> {
    if (!blockPlan?.tasks.some(t => t.id === taskForBlocker)) { setNotice('Selecciona una tarea válida.'); return }
    const blocker: HubBlocker = {
      id: newId('block'), planId: blockPlan.id, taskId: taskForBlocker,
      observation: observation.trim(), recommendedAction: recommendation.trim(), createdAt: stamp()
    }
    if (await persist({ ...state, blockers: [...state.blockers, blocker] },
      'Bloqueo guardado. Atlas puede proponer una revisión; nada se reejecutó.')) {
      setObservation(''); setRecommendation('')
    }
  }
  async function addMemory(): Promise<void> {
    const candidate: HubMemoryCandidate = {
      id: newId('memo'), lesson: lesson.trim(),
      applicability: `profile=${memoryProfile};tags=${memoryTags.join(',')}`,
      evidenceRef: memoryEvidence.trim(), createdAt: stamp()
    }
    if (await persist({ ...state, memories: [...state.memories, candidate] },
      'Aprendizaje candidato guardado. Requiere verificación humana.')) {
      setLesson(''); setApplicability(''); setMemoryEvidence('')
    }
  }
  async function decide(subject: HubHumanDecision['subject'], subjectId: string, verdict: HubHumanDecision['verdict'], justification: string): Promise<boolean> {
    if (justification.trim().length < 5) { setNotice('La decisión requiere una justificación.'); return false }
    const entry: HubHumanDecision = {
      id: newId('decision'), subject, subjectId, verdict,
      justification: justification.trim(), createdAt: stamp()
    }
    return persist({ ...state, decisions: [...state.decisions, entry] },
      'Decisión humana registrada; no se inició ningún agente ni se verificó CI.')
  }
  async function addReview(): Promise<void> {
    if (!reviewPlan?.tasks.some(t => t.id === qaTask)) { setNotice('Selecciona una tarea para QA.'); return }
    const review: HubQualityReview = {
      id: newId('review'), planId: reviewPlan.id, taskId: qaTask, reviewer: 'human',
      verdict: qaVerdict, evidenceRef: qaEvidence.trim(), findings: qaFindings.trim(),
      createdAt: stamp()
    }
    if (await persist({ ...state, reviews: [...state.reviews, review] },
      'Informe QA registrado como declaración humana, no como CI verificado.')) {
      setQaFindings(''); setQaEvidence(''); setQaVerdict('inconclusive')
    }
  }
  return <section className="space-y-3 text-xs">
    <h3 className="text-sm font-semibold">Inteligencia de agentes · laboratorio</h3>
    <p className="text-muted-foreground">
      Propuestas auditables; no se ejecutan ni se convierten en éxito automáticamente.
      Los planes aprobados pueden materializar Run/Task tras una confirmación nativa.
      Dispatch y ejecución requieren autorización separada del host.
    </p>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Atlas · planificación y DAG</h4>
      <p>{state.plans.length} planes propuestos · {state.blockers.length} bloqueos reportados</p>
      <label className="block">Replanificar desde un bloqueo (opcional)
        <select className={field} value={blockerForReplan} disabled={busy}
          onChange={e => setBlockerForReplan(e.target.value)}>
          <option value="">Plan inicial</option>
          {state.blockers.map(b => <option value={b.id} key={b.id}>{state.plans.find(p => p.id === b.planId)?.objective.slice(0, 55) ?? 'Plan'} · {b.taskId}: {b.observation.slice(0, 60)}</option>)}
        </select>
      </label>
      <button className={action} type="button" disabled={busy}
        onClick={() => void copy(renderAtlasPlanningPrompt(doc,previous,chosenBlocker))}>
        Copiar encargo Atlas (SOUL.md)
      </button>
      <label className="block">Propuesta JSON de Atlas (no ejecutable)
        <textarea className={field} rows={5} value={rawPlan} disabled={busy} maxLength={30000}
          onChange={e => setRawPlan(e.target.value)}
          placeholder='{"objective":"...","rationale":"...","tasks":[{"id":"t1","title":"...","role":"forge","dependsOn":[],"acceptance":"..."}]}'/>
      </label>
      <button className={action} type="button" disabled={busy||!rawPlan.trim()||state.plans.length>=30}
        onClick={() => void importPlan()}>Validar DAG y guardar propuesta</button>
      {state.plans.map(p => {
        const decision = decisions.get(`plan:${p.id}`)
        return <div className="rounded border border-border p-2" key={p.id}>
          <strong>{p.objective}</strong>
          <p className="text-muted-foreground">{p.previousPlanId ? 'Replanificación' : 'Plan inicial'} · {p.tasks.length} tareas</p>
          <ul className="ml-4 list-disc">{p.tasks.map(t => <li key={t.id}>
            {t.title} ({t.role}) · {t.dependsOn.length ? `Depende de: ${t.dependsOn.join(', ')}` : 'Sin dependencias'}
          </li>)}</ul>
          {decision ? <p className="mt-2 text-muted-foreground">
            {decision.verdict === 'accepted' ? 'Aprobado manualmente' : 'Rechazado manualmente'} · {decision.justification}
          </p> : <DecisionEditor subject="plan" subjectId={p.id} busy={busy} onDecide={decide}/>}
          <button className={action} type="button" disabled={busy || previewBusy}
            onClick={() => void inspectNativePlan(p.id)}>
            Inspeccionar conversión nativa (sin ejecutar)
          </button>
          {currentPreview?.planId === p.id && <div className="mt-2 space-y-2 rounded border border-border p-2" role="status">
            <p><strong>Vista previa del Run de Orca</strong> · revisión {currentPreview.revision}</p>
            <p>{currentPreview.approval === 'accepted' ? 'Plan aprobado manualmente' :
              currentPreview.approval === 'rejected' ? 'Plan rechazado' : 'Plan sin aprobar'} · no autoriza ejecución</p>
            <p className="break-all text-muted-foreground">SHA del plan: {currentPreview.planSha}</p>
            <ol className="ml-4 list-decimal">{currentPreview.tasks.map(t => <li key={t.id}>
              {t.id} · {t.title} ({t.role}) · {t.dependsOn.length ?
                `Depende de: ${t.dependsOn.join(', ')}` : 'Sin dependencias'}
            </li>)}</ol>
            <p className="font-medium">Vista previa sin efectos. Materializar crea solo Run/Task, nunca Dispatch.</p>
            {currentPreview.approval === 'accepted' && <button className={action} type="button"
              disabled={stageBusy || busy || recoveryBusy || !!recoveryError ||
                currentRecovery?.status === 'needs_reconciliation' ||
                !gitContext || gitContext.hostId !== 'local'}
              onClick={() => void stageNativePlan(currentPreview)}>
              {stageBusy ? 'Validando y solicitando aprobación…' : 'Crear Run/Task nativo (supervisado)'}
            </button>}
            {gitContext?.hostId === 'local' && <button className={action} type="button"
              disabled={stageBusy || busy || recoveryBusy}
              onClick={() => void inspectNativeRecovery(currentPreview)}>
              {recoveryBusy ? 'Conciliando SQLite…' : 'Reconciliar Run/Task desde el host (solo lectura)'}
            </button>}
            {currentRecovery?.status === 'not_found' &&
              <p className="text-muted-foreground">No hay Run nativo registrado para este plan y worktree.</p>}
            {currentRecovery?.status === 'needs_reconciliation' &&
              <p role="alert" className="font-semibold text-destructive">
                Operación anterior incierta: no crear otro Run. Requiere conciliación del host.
              </p>}
            {currentRecovery?.entries.map(entry => <div key={entry.baseSha}
              className="rounded border border-border p-2" role="status">
              <p>Recibo de SQLite: {entry.disposition === 'completed_verified'
                ? 'Run confirmado' : 'Conciliación manual requerida'} · {entry.state}</p>
              <p>HEAD original: <code>{entry.baseSha.slice(0, 12)}</code></p>
              <p>Run: <code>{entry.runId ?? 'No confirmado'}</code> · {entry.recordedTaskCount} tareas registradas</p>
              <p>Dispatch observados: {entry.dispatchCount} · evidencia: {entry.evidence}</p>
              {entry.tasks && <ul className="ml-4 list-disc">
                {Object.entries(entry.tasks).map(([hubId, nativeId]) =>
                  <li key={hubId}>{hubId} → <code>{nativeId}</code></li>)}
              </ul>}
            </div>)}
            {recoveryError && <p role="alert" className="text-destructive">
              No se pudo consultar la identidad nativa: {recoveryError}
            </p>}
            {staged?.revision === doc.revision && staged.receipt.planId === p.id &&
              <div className="rounded border border-border p-2" role="status">
                <p>Run real: <code>{staged.receipt.runId}</code> · {staged.receipt.reused ? 'reutilizado' : 'nuevo'}</p>
                <p>HEAD verificado: <code>{staged.receipt.baseSha.slice(0, 12)}</code></p>
                <ul className="ml-4 list-disc">{Object.entries(staged.receipt.tasks).map(([hubId, nativeId]) =>
                  <li key={hubId}>{hubId} → <code>{nativeId}</code></li>)}</ul>
                <p className="font-semibold">Sin Dispatch ni agentes ejecutándose.</p>
              </div>}
          </div>}
        </div>
      })}
      {previewError && <p role="alert" className="text-destructive">Vista previa rechazada: {previewError}</p>}
    </section>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Bloqueos · replanificación supervisada</h4>
      <select className={field} value={planForBlocker} disabled={busy}
        onChange={e => {setPlanForBlocker(e.target.value);setTaskForBlocker('')}}>
        <option value="">Seleccionar plan</option>
        {state.plans.map(p => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
      </select>
      <select className={field} value={taskForBlocker} disabled={busy}
        onChange={e => setTaskForBlocker(e.target.value)}>
        <option value="">Seleccionar tarea</option>
        {blockPlan?.tasks.map(t => <option value={t.id} key={t.id}>{t.id} · {t.title}</option>)}
      </select>
      <textarea className={field} value={observation} maxLength={2000} disabled={busy}
        placeholder="Bloqueo observado, con evidencia" onChange={e => setObservation(e.target.value)}/>
      <textarea className={field} value={recommendation} maxLength={1600} disabled={busy}
        placeholder="Cambio propuesto para Atlas" onChange={e => setRecommendation(e.target.value)}/>
      <button className={action} type="button" disabled={busy||!taskForBlocker||observation.trim().length<5||recommendation.trim().length<5}
        onClick={() => void reportBlocker()}>Registrar bloqueo (sin reintento)</button>
    </section>
    <ProjectHubNativeDraftPanel doc={doc} gitContext={gitContext}/>
    <ProjectHubHandoffPanel doc={doc} busy={busy} onSave={onSave} gitContext={gitContext}/>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Forge · memoria con evidencias</h4>
      <p>{approvedHubMemories(state).length} memorias aprobadas · {eligibleMemoryCount} reutilizables en contexto acotado · {state.memories.length} propuestas</p>
      <p className="text-muted-foreground">Solo las lecciones aprobadas manualmente, con rol, etiquetas y commit declarado, podrán aparecer en prompts de otros CLI. No verifica Git ni sincroniza Hermes.</p>
      <textarea className={field} disabled={busy} value={lesson} maxLength={220}
        onChange={e => setLesson(e.target.value)} placeholder="Lección aprendida (sin secretos)"/>
      <label className="block">Perfil que podrá reutilizarla
        <select aria-label="Perfil de memoria" className={field} disabled={busy}
          value={memoryProfile} onChange={e => setMemoryProfile(e.target.value as HubAgentProfile | 'all')}>
          <option value="all">Todos los perfiles del proyecto</option>
          {HUB_AGENT_PROFILES.map(profile => <option key={profile} value={profile}>{profile}</option>)}
        </select>
      </label>
      <input className={field} disabled={busy} value={applicability} maxLength={255}
        onChange={e => setApplicability(e.target.value)}
        placeholder="Etiquetas, separadas por comas (ej. sqlite,persistence)"/>
      <input className={field} disabled={busy} value={memoryEvidence} maxLength={47}
        onChange={e => setMemoryEvidence(e.target.value)}
        placeholder="commit:SHA de 40 caracteres (declarado)"/>
      <button className={action} type="button" disabled={busy||!reusableMemoryValid}
        onClick={() => void addMemory()}>Proponer aprendizaje</button>
      {state.memories.map(m => {
        const decision = decisions.get(`memory:${m.id}`)
        return <div key={m.id} className="rounded border border-border p-2">
          <p><strong>{m.lesson}</strong></p>
          <p className="text-muted-foreground">Aplicación: {m.applicability}</p>
          <p className="text-muted-foreground">Evidencia declarada: {m.evidenceRef}</p>
          {decision ? <p className="mt-2 text-muted-foreground">
            {decision.verdict === 'accepted' ? 'Aprendizaje aprobado manualmente' :
              decision.verdict === 'revoked' ? 'Aprendizaje revocado' : 'Aprendizaje rechazado'} · {decision.justification}
          </p> : <DecisionEditor subject="memory" subjectId={m.id} busy={busy} onDecide={decide}/>}
          {decision?.verdict === 'accepted' && <DecisionEditor key={`revoke-${m.id}`}
            subject="memory" subjectId={m.id} mode="revoke" busy={busy} onDecide={decide}/>} 
        </div>
      })}
    </section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">QA · notas manuales heredadas</h4>
      <p className="text-muted-foreground">Registro manual. No existe todavía un revisor automático ni consulta verificada de CI.</p>
      <label className="block">1. ¿Qué plan revisaremos?
        <select aria-label="Plan para QA" className={field} disabled={busy} value={qaPlan}
          onChange={e => {setQaPlan(e.target.value);setQaTask('')}}>
          <option value="">Seleccionar plan</option>
          {state.plans.map(p => <option value={p.id} key={p.id}>{planLabel(p)}</option>)}
        </select>
      </label>
      <label className="block">2. ¿Qué tarea revisaremos?
        <select aria-label="Tarea para QA" className={field} disabled={busy || !reviewPlan} value={qaTask}
          onChange={e => setQaTask(e.target.value)}>
          <option value="">Seleccionar tarea</option>
          {reviewPlan?.tasks.map(t => <option value={t.id} key={t.id}>{t.title} · {t.role} ({t.id})</option>)}
        </select>
      </label>
      {reviewPlan?.tasks.filter(t => t.id === qaTask).map(t =>
        <p key={t.id} className="rounded border border-border p-2 text-muted-foreground">Criterio de aceptación: {t.acceptance}</p>)}
      <label className="block">3. Evidencia que revisará QA
        <input className={field} disabled={busy || !qaTask} value={qaEvidence} maxLength={600}
          onChange={e => setQaEvidence(e.target.value)}
          placeholder="SHA de commit, diff, test o URL de CI (referencia, no verificada)"/>
      </label>
      <button className={action} type="button" disabled={busy || !reviewPlan || !qaTask || qaEvidence.trim().length < 5}
        onClick={() => reviewPlan && void copy(renderQaReviewPrompt(doc, reviewPlan, qaTask, qaEvidence))}>
        Copiar encargo para QA externo (no ejecuta el agente)
      </button>
      <label className="block">4. Resultado de la revisión manual
        <select aria-label="Resultado de QA" className={field} disabled={busy || !qaTask} value={qaVerdict}
          onChange={e => setQaVerdict(e.target.value as HubQualityReview['verdict'])}>
          <option value="inconclusive">Sin evidencia suficiente</option>
          <option value="changes-requested">Solicitar correcciones</option>
          <option value="approved">Aprobación declarada por una persona</option>
        </select>
      </label>
      <label className="block">Hallazgos y comprobaciones realizadas
        <textarea className={field} disabled={busy || !qaTask} value={qaFindings} maxLength={2000}
          onChange={e => setQaFindings(e.target.value)} placeholder="Qué revisaste, qué pasó y qué falta"/>
      </label>
      <button className={action} type="button"
        disabled={busy || !reviewPlan || !qaTask || qaEvidence.trim().length < 5 || qaFindings.trim().length < 5}
        onClick={() => void addReview()}>Registrar resultado manual (sin verificar CI)</button>
      <h5 className="font-semibold">Revisiones anteriores</h5>
      {state.reviews.map(r => {
        const p = state.plans.find(candidate => candidate.id === r.planId)
        const t = p?.tasks.find(candidate => candidate.id === r.taskId)
        return <div key={r.id} className="rounded border border-border p-2">
          <p><strong>{t?.title ?? r.taskId}</strong> · {p?.objective ?? r.planId}</p>
          <p>{r.verdict === 'approved' ? 'Aprobación declarada' : r.verdict === 'changes-requested' ? 'Correcciones solicitadas' : 'Sin evidencia suficiente'} · revisión {r.reviewer === 'human' ? 'humana' : 'QA'}</p>
          <p className="text-muted-foreground">Evidencia declarada: {r.evidenceRef}</p>
          <p>{r.findings}</p>
        </div>
      })}
      {!state.reviews.length && <p className="text-muted-foreground">Aún no hay revisiones registradas.</p>}
    </section>
    <section className="rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Historial de decisiones (append-only)</h4>
      {state.decisions.map(d => <p key={d.id} className="mt-1 break-words">{d.subject} {d.subjectId}: {d.verdict} · {d.justification}</p>)}
      {!state.decisions.length && <p className="text-muted-foreground">Sin decisiones registradas.</p>}
    </section>
    {notice && <p className="rounded border border-border p-2" role="status">{notice}</p>}
  </section>
}
