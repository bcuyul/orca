/** Human-entered mathematical scenario. No persisted metrics or agent actions. */
import { useEffect, useMemo, useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import { previewNativeAgentRouting } from '../../../../shared/project-hub-native-agent-routing'
import {
  simulateProjectHubMath, type ProjectHubMathResult
} from '../../../../shared/project-hub-math-preview'

type Props = { doc: HubDocument }
type Criterion = 'user' | 'unlock' | 'urgency'
type EstimateField = Criterion | 'effort'
type EstimateText = Record<EstimateField, string>
const criteria = [
  { id: 'user', label: 'Valor usuario' },
  { id: 'unlock', label: 'Desbloqueo' },
  { id: 'urgency', label: 'Urgencia' }
] as const
const blank: EstimateText = { user: '', unlock: '', urgency: '', effort: '' }
const inputClass = 'w-full rounded border border-border bg-background px-2 py-1.5 text-xs'
const toNumber = (text: string): number => {
  if (!text.trim()) { throw new Error('Completa todas las estimaciones y pesos swing') }
  const value = Number(text)
  if (!Number.isFinite(value)) { throw new Error('Las estimaciones deben ser números finitos') }
  return value
}

export default function ProjectHubMathPreview({ doc }: Props): React.JSX.Element {
  const approvedId = useMemo(() =>
    previewNativeAgentRouting(doc, 'pending', null).approvedPlanId, [doc])
  const plan = doc.intelligence?.plans.find(item => item.id === approvedId)
  const [swing, setSwing] = useState<Record<Criterion, string>>({
    user: '', unlock: '', urgency: ''
  })
  const [budget, setBudget] = useState('')
  const [estimates, setEstimates] = useState<Record<string, EstimateText>>({})
  const [result, setResult] = useState<ProjectHubMathResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // Never carry another plan's or project's manual estimates into a new scenario.
    setResult(null)
    setError('')
    setEstimates({})
    setSwing({ user: '', unlock: '', urgency: '' })
    setBudget('')
  }, [doc.projectId, approvedId])

  function changeEstimate(id: string, field: EstimateField, value: string): void {
    setEstimates(previous => ({
      ...previous, [id]: { ...blank, ...previous[id], [field]: value }
    }))
    setResult(null)
    setError('')
  }
  function calculate(): void {
    if (!plan) { return }
    setError('')
    setResult(null)
    try {
      const calculated = simulateProjectHubMath({
        document: doc,
        swing: {
          user: toNumber(swing.user),
          unlock: toNumber(swing.unlock),
          urgency: toNumber(swing.urgency)
        },
        budget: toNumber(budget),
        estimates: plan.tasks.map(task => {
          const row = estimates[task.id] ?? blank
          return {
            id: task.id,
            criteria: {
              user: toNumber(row.user),
              unlock: toNumber(row.unlock),
              urgency: toNumber(row.urgency)
            },
            estimatedEffort: toNumber(row.effort)
          }
        })
      })
      setResult(calculated)
    } catch (reason) {
      setError(String(reason))
    }
  }

  return <details className="rounded-lg border border-border bg-card p-3 text-xs"
    aria-label="Laboratorio matemático de priorización">
    <summary className="cursor-pointer text-sm font-semibold">
      Optimización matemática · MCDA, valor/esfuerzo y presupuesto (simulación)
    </summary>
    <p className="mt-2 text-muted-foreground">
      Usa criterios estimados por una persona. No se generan probabilidades, pesos
      automáticos, Cost of Delay ni permisos. La selección es una heurística, no un óptimo.
    </p>
    {!plan ? <p className="mt-2">Aprueba manualmente un plan de Atlas para realizar la simulación.</p> :
      <div className="mt-3 space-y-3">
        <p className="font-semibold">Plan: {plan.id} · {plan.tasks.length} tareas</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {criteria.map(field => <label key={field.id} className="space-y-1">
            Swing {field.label} (0–100)
            <input type="number" min={0} max={100} step="any" value={swing[field.id]}
              className={inputClass} placeholder="Sin estimar"
              onChange={e => {
                setSwing(current => ({ ...current, [field.id]: e.target.value }))
                setResult(null)
              }}/>
          </label>)}
          <label className="space-y-1">
            Presupuesto de esfuerzo
            <input type="number" min={0} step="any" value={budget}
              className={inputClass} placeholder="Sin estimar"
              onChange={e => { setBudget(e.target.value); setResult(null) }}/>
          </label>
        </div>
        <p className="text-muted-foreground">
          Los swings miden el valor de mejorar cada criterio desde su peor al mejor nivel.
          Todas las estimaciones de esfuerzo deben usar la misma unidad.
        </p>
        <div className="space-y-2">
          {plan.tasks.map(task => {
            const row = estimates[task.id] ?? blank
            return <div key={task.id} className="rounded border border-border p-2">
              <p className="mb-2 font-medium">{task.id} · {task.title}</p>
              <p className="mb-2 text-muted-foreground">
                {task.role} · Dependencias: {task.dependsOn.join(', ') || 'ninguna'}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {criteria.map(field => <label key={field.id} className="space-y-1">
                  {field.label} (0–100)
                  <input type="number" min={0} max={100} step="any"
                    aria-label={task.id + ' ' + field.label} value={row[field.id]}
                    placeholder="Sin estimar" className={inputClass}
                    onChange={e => changeEstimate(task.id, field.id, e.target.value)}/>
                </label>)}
                <label className="space-y-1">
                  Esfuerzo
                  <input type="number" min={0} step="any" value={row.effort}
                    aria-label={task.id + ' Esfuerzo'} className={inputClass}
                    placeholder="Sin estimar"
                    onChange={e => changeEstimate(task.id, 'effort', e.target.value)}/>
                </label>
              </div>
            </div>
          })}
        </div>
        <button type="button" onClick={calculate}
          className="rounded border border-border bg-muted px-3 py-2">
          Calcular escenario (sin ejecutar)
        </button>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {result && <div className="space-y-2 rounded border border-border p-3">
          <p className="font-semibold">Resultado matemático del escenario, no verificado</p>
          <p>
            MCDA: V = wᵤ·Usuario + wₐ·Desbloqueo + wᵣ·Urgencia.
            Pesos: {result.weights.user.toFixed(3)} /
            {' '}{result.weights.unlock.toFixed(3)} /
            {' '}{result.weights.urgency.toFixed(3)}.
          </p>
          <p>Prioridad por V/esfuerzo: {result.rankingByValuePerEffort.map(row =>
            row.id + ' (' + row.valuePerEffort.toFixed(2) + ')'
          ).join(' → ')}</p>
          {([
            ['FIFO', result.fifo],
            ['MCDA / esfuerzo', result.valuePerEffort]
          ] as const).map(([label, selection]) =>
            <p key={label} className="break-words">
              <strong>{label}:</strong> {selection.selectedIds.join(' → ') || 'Sin selección'}
              {' '}· esfuerzo {selection.totalEffort.toFixed(2)}
              {' '}· valor aditivo {selection.totalValue.toFixed(2)}
            </p>)}
          <p role="status" className="font-medium text-muted-foreground">
            No se admite ninguna tarea a ejecución: faltan permisos, evidencia del host,
            presupuesto real reservado, dependencias terminadas y sandbox verificable.
          </p>
        </div>}
      </div>}
  </details>
}
