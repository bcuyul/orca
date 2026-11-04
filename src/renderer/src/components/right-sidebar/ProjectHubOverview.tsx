/** One project-wide, read-only view. Evidence claims stay explicitly human-attested. */
import { useMemo } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import { projectHubOverview } from '../../../../shared/project-hub-overview'
import type { HubHandoffStage } from '../../../../shared/project-hub-handoff-readiness'

const stageLabels: Record<HubHandoffStage, string> = {
  plan_not_accepted: 'Plan pendiente',
  role_only: 'Rol planificado; no ejecutado',
  awaiting_external_delivery: 'Entrega externa pendiente',
  awaiting_qa: 'QA pendiente para este commit',
  changes_requested: 'QA solicita correcciones (declarado)',
  qa_inconclusive: 'QA inconcluso (declarado)',
  qa_approved_attested: 'QA aprobado (declarado, sin CI)',
  blocked: 'Bloqueado'
}

type Props = { doc: HubDocument }
export default function ProjectHubOverview({ doc }: Props): React.JSX.Element {
  const overview = useMemo(() => projectHubOverview(doc), [doc])
  const metrics = [
    ['Historias de Backlog', overview.backlog.total],
    ['Planes aprobados', overview.plans.accepted],
    ['Entregas externas declaradas', overview.implementations],
    ['Revisiones QA vinculadas', overview.linkedReviews]
  ] as const
  return <div className="space-y-3" aria-label="Resumen unificado del proyecto">
    <div className="grid grid-cols-2 gap-2">
      {metrics.map(([label, value]) =>
        <div key={label} className="rounded-lg border border-border bg-card p-3">
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>)}
    </div>
    <section className="rounded-lg border border-border bg-card p-3 text-xs">
      <h3 className="mb-2 text-sm font-semibold">Estado real del proyecto</h3>
      <p className="text-muted-foreground">
        Backlog: {overview.backlog.ready} Ready · {overview.backlog.done} terminadas ·
        {' '}{overview.backlog.review} en revisión · {overview.backlog.blocked} bloqueadas.
        Las historias del Backlog aún no se sincronizan automáticamente con el DAG.
      </p>
      <p className="mt-1 text-muted-foreground">
        {overview.historicalReviews} revisiones QA históricas · {overview.plans.total} planes propuestos.
        Las aprobaciones externas no acreditan ejecución ni CI.
      </p>
      {!overview.activePlan ?
        <p className="mt-2">Sin plan de Atlas registrado.</p> :
        <div className="mt-3 space-y-2">
          <p className="font-medium">{overview.activePlan.objective}</p>
          <p className="text-muted-foreground">
            {overview.activePlan.accepted ? 'Plan aprobado manualmente' : 'Plan no aprobado'} ·
            {' '}{overview.activePlan.tasks.length} tareas ·
            {' '}{overview.activePlan.qaAttested} QA declarados vigentes ·
            {' '}{overview.activePlan.awaitingQa} QA pendientes ·
            {' '}{overview.activePlan.blocked} bloqueos
          </p>
          {overview.activePlan.tasks.map(task =>
            <div key={task.id} className="rounded border border-border p-2">
              <div className="font-medium">{task.id} · {task.title}</div>
              <p className="text-muted-foreground">{stageLabels[task.stage]}</p>
              {task.implementation && <p className="break-all text-muted-foreground">
                Commit declarado: {task.implementation.headSha.slice(0, 12)} · evidencia externa no verificada
              </p>}
            </div>)}
        </div>}
    </section>
    <section className="rounded-lg border border-border bg-card p-3 text-xs">
      <h3 className="mb-2 text-sm font-semibold">Actividad y trazabilidad</h3>
      {overview.recentActivity.length ?
        <ol className="space-y-2">
          {overview.recentActivity.map(event =>
            <li key={event.id} className="border-b border-border pb-2 last:border-b-0 last:pb-0">
              <p className="font-medium">{event.title}</p>
              <p className="break-words text-muted-foreground">{event.description}</p>
              <p className="text-muted-foreground">
                {event.provenance === 'external-unverified' ?
                  'Entrega externa no verificada' : 'Declaración humana'}
              </p>
            </li>)}
        </ol> :
        <p className="text-muted-foreground">Sin actividad de Atlas, Forge o QA registrada.</p>}
    </section>
    <p className="rounded border border-border p-2 text-xs text-muted-foreground" role="status">
      Proyección de solo lectura. No crea Run, Task, Dispatch ni sesiones; no verifica CI ni
      autoriza agentes. La aprobación de fase se controla por separado.
    </p>
  </div>
}
