import { useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  runHubCodeModeReadOnly, type HubCodeModeReport
} from '../../../../shared/project-hub-code-mode-readonly'

type Props = { document: HubDocument }

/** Snapshot-only report. Never offers code execution or a host-owned capability. */
export default function ProjectHubCodeModeReadOnly({ document }: Props): React.JSX.Element {
  const [report, setReport] = useState<HubCodeModeReport | null>(null)
  const current = report?.projectId === document.projectId &&
    report.revision === document.revision ? report : null

  return <section className="rounded-lg border border-border bg-card p-3 text-xs">
    <h3 className="text-sm font-semibold">Code Mode local · laboratorio de lectura</h3>
    <p className="mt-2 text-muted-foreground">
      Agrupa tres consultas del proyecto cargado, sin enviar información a modelos ni
      crear sesiones, Dispatch o procesos. No interpreta JavaScript generado.
    </p>
    <button type="button" className="mt-3 rounded border border-border bg-muted px-3 py-2"
      onClick={() => setReport(runHubCodeModeReadOnly(document, document.projectId))}>
      Analizar snapshot · 0 tokens IA
    </button>
    {current && <div className="mt-3 space-y-2" aria-live="polite">
      <p className="text-muted-foreground">
        {current.status === 'complete' ? 'Análisis local completo' : 'Análisis bloqueado'}
        {' · '}{current.toolCalls} herramientas locales
        {' · '}{current.externalCalls} llamadas externas
        {' · '}{current.modelCalls} llamadas a modelos
      </p>
      {current.blockers.map(reason => <p key={reason} role="alert">{reason}</p>)}
      {current.steps.map(step => <div key={step.tool} className="rounded border border-border p-2">
        <p className="font-medium">{step.tool}</p>
        <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
          {JSON.stringify(step.result, null, 2)}
        </pre>
      </div>)}
    </div>}
  </section>
}
