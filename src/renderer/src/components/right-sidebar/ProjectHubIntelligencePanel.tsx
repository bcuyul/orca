/** Human-gated intelligence records. No agent launch, git write or CI action here. */
import { useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  emptyHubIntelligence, isHubIntelligence, approvedHubMemories,
  type HubIntelligence, type HubHumanDecision, type HubBlocker,
  type HubMemoryCandidate, type HubQualityReview
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
  const [decisionNote, setDecisionNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [qaPlan, setQaPlan] = useState('')
  const [qaTask, setQaTask] = useState('')
  const [qaEvidence, setQaEvidence] = useState('')
  const [qaFindings, setQaFindings] = useState('')
  const [qaVerdict, setQaVerdict] = useState<HubQualityReview['verdict']>('inconclusive')

  const chosenBlocker = state.blockers.find(b => b.id === blockerForReplan)
  const previous = state.plans.find(p => p.id === chosenBlocker?.planId)
  const blockPlan = state.plans.find(p => p.id === planForBlocker)
  const reviewPlan = state.plans.find(p => p.id === qaPlan)
  const decided = new Set(state.decisions.map(d => `${d.subject}:${d.subjectId}`))
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
    } catch (error) { setNotice('Propuesta rechazada: ' + String(error)) }
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
  async function decide(subject: HubHumanDecision['subject'], subjectId: string, verdict: HubHumanDecision['verdict']): Promise<void> {
    if (!confirmed || decisionNote.trim().length < 5) { setNotice('Confirma la revisión y justifica la decisión.'); return }
    const entry: HubHumanDecision = {
      id: newId('decision'), subject, subjectId, verdict,
      justification: decisionNote.trim(), createdAt: stamp()
    }
    if (await persist({ ...state, decisions: [...state.decisions, entry] },
      'Decisión humana registrada. No crea Run ni despliega código.')) {
      setConfirmed(false); setDecisionNote('')
    }
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
      setQaFindings('')
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
          {state.blockers.map(b => <option value={b.id} key={b.id}>{b.taskId} · {b.id}</option>)}
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
      {state.plans.map(p => <div className="rounded border border-border p-2" key={p.id}>
        <strong>{p.objective}</strong>
        <p className="text-muted-foreground">{p.id} · {p.tasks.length} tareas · {p.previousPlanId?'Revisión propuesta':'Plan inicial'}</p>
        <p>{p.tasks.map(t => `${t.id} (${t.role}): ${t.dependsOn.join(', ')||'sin bloqueos'}`).join(' · ')}</p>
        <p>{decided.has(`plan:${p.id}`) ? 'Decisión registrada (ver historial)' : 'Pendiente de decisión humana'}</p>
        {!decided.has(`plan:${p.id}`) && <div className="mt-2 flex gap-2">
          <button className={action} type="button" disabled={busy||!confirmed||decisionNote.trim().length<5}
            onClick={() => void decide('plan',p.id,'accepted')}>Aceptar propuesta</button>
          <button className={action} type="button" disabled={busy||!confirmed||decisionNote.trim().length<5}
            onClick={() => void decide('plan',p.id,'rejected')}>Rechazar</button>
        </div>}
      </div>)}
      <label className="block">Justificación de decisión
        <textarea className={field} value={decisionNote} disabled={busy} maxLength={1000}
          onChange={e => setDecisionNote(e.target.value)} rows={2}/>
      </label>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={e => setConfirmed(e.target.checked)}/> Confirmo revisión humana de la propuesta o memoria</label>
    </section>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Bloqueos · replanificación supervisada</h4>
      <select className={field} value={planForBlocker} disabled={busy}
        onChange={e => {setPlanForBlocker(e.target.value);setTaskForBlocker('')}}>
        <option value="">Seleccionar plan</option>
        {state.plans.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
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
      {state.memories.map(m => <div key={m.id} className="rounded border border-border p-2">
        <p><strong>{m.lesson}</strong></p><p className="text-muted-foreground">{m.evidenceRef}</p>
        {decided.has(`memory:${m.id}`) ? <p>Decisión ya registrada</p> :
          <div className="mt-2 flex gap-2">
            <button className={action} type="button" disabled={busy||!confirmed||decisionNote.trim().length<5}
              onClick={() => void decide('memory',m.id,'accepted')}>Verificar y aprobar</button>
            <button className={action} type="button" disabled={busy||!confirmed||decisionNote.trim().length<5}
              onClick={() => void decide('memory',m.id,'rejected')}>Rechazar</button>
          </div>}
      </div>)}
    </section>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">QA · revisión independiente</h4>
      <p>Se registra evidencia humana; copiar el prompt no inicia un revisor.</p>
      <select className={field} disabled={busy} value={qaPlan}
        onChange={e => {setQaPlan(e.target.value);setQaTask('')}}>
        <option value="">Seleccionar plan</option>
        {state.plans.map(p => <option value={p.id} key={p.id}>{p.id}</option>)}
      </select>
      <select className={field} disabled={busy} value={qaTask}
        onChange={e => setQaTask(e.target.value)}>
        <option value="">Seleccionar tarea</option>
        {reviewPlan?.tasks.map(t => <option value={t.id} key={t.id}>{t.id} · {t.title}</option>)}
      </select>
      <input className={field} disabled={busy} value={qaEvidence} maxLength={600}
        onChange={e => setQaEvidence(e.target.value)} placeholder="Ref. commit/diff/checks verificados"/>
      <button className={action} type="button" disabled={busy||!reviewPlan||!qaTask||qaEvidence.trim().length<5}
        onClick={() => reviewPlan && void copy(renderQaReviewPrompt(doc,reviewPlan,qaTask,qaEvidence))}>
        Copiar encargo QA independiente
      </button>
      <select className={field} disabled={busy} value={qaVerdict}
        onChange={e => setQaVerdict(e.target.value as HubQualityReview['verdict'])}>
        <option value="inconclusive">Sin evidencia suficiente</option>
        <option value="changes-requested">Solicita correcciones</option>
        <option value="approved">Aprobación declarada manualmente</option>
      </select>
      <textarea className={field} disabled={busy} value={qaFindings} maxLength={2000}
        onChange={e => setQaFindings(e.target.value)} placeholder="Hallazgos concretos, archivos y pruebas"/>
      <button className={action} type="button"
        disabled={busy||!qaTask||qaEvidence.trim().length<5||qaFindings.trim().length<5}
        onClick={() => void addReview()}>Registrar revisión humana</button>
      {state.reviews.map(r => <p key={r.id} className="rounded border border-border p-2">
        {r.planId}/{r.taskId} · {r.verdict} · {r.findings}
      </p>)}
    </section>
    <section className="rounded-lg border border-border bg-card p-3">
      <h4 className="font-semibold">Historial de decisiones (append-only)</h4>
      {state.decisions.map(d => <p key={d.id} className="mt-1 break-words">{d.subject} {d.subjectId}: {d.verdict} · {d.justification}</p>)}
      {!state.decisions.length && <p className="text-muted-foreground">Sin decisiones registradas.</p>}
    </section>
    {notice && <p className="rounded border border-border p-2" role="status">{notice}</p>}
  </section>
}
