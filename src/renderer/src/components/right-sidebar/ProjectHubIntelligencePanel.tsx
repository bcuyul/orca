/** Human-gated intelligence records. No agent launch, git write or CI action here. */
import { useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  emptyHubIntelligence, isHubIntelligence, approvedHubMemories,
  type HubIntelligence, type HubHumanDecision, type HubBlocker,
  type HubMemoryCandidate, type HubQualityReview, type HubPlanProposal
} from '../../../../shared/project-hub-intelligence'
import {
  parseAtlasPlanJson, renderAtlasPlanningPrompt, renderQaReviewPrompt
} from '../../../../shared/project-hub-intelligence-prompts'
import { createBrowserUuid } from '@/lib/browser-uuid'

type Props = { doc: HubDocument; busy: boolean; onSave: (next: HubDocument) => Promise<boolean> }
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
  onDecide: (subject: HubHumanDecision['subject'], subjectId: string, verdict: HubHumanDecision['verdict'], justification: string) => Promise<boolean>
}

/** Keep each approval's justification beside its target. Never silently authorize execution. */
function DecisionEditor({ subject, subjectId, busy, onDecide }: DecisionEditorProps): React.JSX.Element {
  const [justification, setJustification] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const eligible = !busy && confirmed && justification.trim().length >= 5
  const noun = subject === 'plan' ? 'plan' : 'aprendizaje'
  return <div className="mt-2 space-y-2 rounded border border-border p-2">
    <label className="block">Justificación de la decisión sobre este {noun}
      <textarea className={field} rows={2} value={justification} disabled={busy} maxLength={1000}
        onChange={e => setJustification(e.target.value)} placeholder="Qué evidencia revisaste y por qué decides esto"/>
    </label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy}
      onChange={e => setConfirmed(e.target.checked)}/>
      Confirmo que revisé esta propuesta. La decisión no ejecuta agentes ni verifica CI
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={action} type="button" disabled={!eligible}
        onClick={() => void onDecide(subject, subjectId, 'accepted', justification)}>
        Aprobar {noun}
      </button>
      <button className={action} type="button" disabled={!eligible}
        onClick={() => void onDecide(subject, subjectId, 'rejected', justification)}>
        Rechazar {noun}
      </button>
    </div>
  </div>
}

export default function ProjectHubIntelligencePanel({ doc, busy, onSave }: Props): React.JSX.Element {
  const state = doc.intelligence ?? emptyHubIntelligence()
  const [notice, setNotice] = useState('')
  const [rawPlan, setRawPlan] = useState('')
  const [blockerForReplan, setBlockerForReplan] = useState('')
  const [planForBlocker, setPlanForBlocker] = useState('')
  const [taskForBlocker, setTaskForBlocker] = useState('')
  const [observation, setObservation] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [lesson, setLesson] = useState('')
  const [applicability, setApplicability] = useState('')
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
  async function persist(next: HubIntelligence, success: string): Promise<boolean> {
    if (!isHubIntelligence(next)) { setNotice('Registro inválido: revisa IDs, DAG y evidencia.'); return false }
    const ok = await onSave({ ...doc, intelligence: next })
    setNotice(ok ? success : 'No se pudo guardar; revisa el mensaje de Project Hub.')
    return ok
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
      id: newId('memo'), lesson: lesson.trim(), applicability: applicability.trim(),
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
      El bridge con Runs/Tasks/Dispatches y los agentes autónomos sigue pendiente.
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
        </div>
      })}
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
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Forge · memoria con evidencias</h4>
      <p>{approvedHubMemories(state).length} memorias aprobadas · {state.memories.length} propuestas</p>
      <textarea className={field} disabled={busy} value={lesson} maxLength={1500}
        onChange={e => setLesson(e.target.value)} placeholder="Lección aprendida (sin secretos)"/>
      <input className={field} disabled={busy} value={applicability} maxLength={800}
        onChange={e => setApplicability(e.target.value)} placeholder="Cuándo aplicar esta lección"/>
      <input className={field} disabled={busy} value={memoryEvidence} maxLength={600}
        onChange={e => setMemoryEvidence(e.target.value)} placeholder="Archivo, test, commit o evidencia verificable"/>
      <button className={action} type="button" disabled={busy||lesson.trim().length<5||applicability.trim().length<5||memoryEvidence.trim().length<5}
        onClick={() => void addMemory()}>Proponer aprendizaje</button>
      {state.memories.map(m => {
        const decision = decisions.get(`memory:${m.id}`)
        return <div key={m.id} className="rounded border border-border p-2">
          <p><strong>{m.lesson}</strong></p>
          <p className="text-muted-foreground">Aplicación: {m.applicability}</p>
          <p className="text-muted-foreground">Evidencia declarada: {m.evidenceRef}</p>
          {decision ? <p className="mt-2 text-muted-foreground">
            {decision.verdict === 'accepted' ? 'Aprendizaje aprobado manualmente' : 'Aprendizaje rechazado'} · {decision.justification}
          </p> : <DecisionEditor subject="memory" subjectId={m.id} busy={busy} onDecide={decide}/>} 
        </div>
      })}
    </section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">QA · revisión guiada</h4>
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
