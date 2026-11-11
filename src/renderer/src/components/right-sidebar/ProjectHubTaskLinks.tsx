/** Explicit human-authored backlog <-> DAG links. No execution or status changes. */
import { useMemo, useState } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import { projectHubBacklogLinks, projectHubStoryEvidence, type HubTaskLinkEvent } from '../../../../shared/project-hub-backlog-links'
import { createBrowserUuid } from '@/lib/browser-uuid'

type Props = {
  doc: HubDocument
  busy: boolean
  onSave: (next: HubDocument) => Promise<boolean>
}

/** Generate audit metadata only after an explicit click, not during React render. */
function newLinkEvent(planId: string, taskId: string, storyId: string): HubTaskLinkEvent {
  return {
    id: `link-${createBrowserUuid().replaceAll('-', '')}`,
    planId, taskId, storyId: storyId || null, at: new Date().toISOString()
  }
}

export default function ProjectHubTaskLinks({ doc, busy, onSave }: Props): React.JSX.Element {
  const preview = useMemo(() => projectHubBacklogLinks(doc), [doc])
  const evidence = useMemo(() => projectHubStoryEvidence(doc), [doc])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const stories = doc.items.filter(item => item.type === 'story' && !item.archived)
  // Keep historic link targets available for inspection, even if archived.
  const historicalStories = doc.items.filter(item => item.type === 'story' && item.archived)
  const current = preview.tasks.map(task => ({
    ...task, target: draft[`${doc.projectId}:${preview.approvedPlanId}:${task.id}`] ??
      (task.storyId ?? '')
  }))
  async function linkTask(taskId: string, storyId: string): Promise<void> {
    if (busy || !preview.approvedPlanId || (doc.taskLinks?.length ?? 0) >= 100 ||
        !preview.tasks.some(task => task.id === taskId && task.storyId !== (storyId || null)) ||
        (storyId !== '' && !stories.some(item => item.id === storyId))) { return }
    const entry = newLinkEvent(preview.approvedPlanId, taskId, storyId)
    if (await onSave({ ...doc, taskLinks: [...(doc.taskLinks ?? []), entry] })) {
      setDraft(previous => {
        const next = { ...previous }
        delete next[`${doc.projectId}:${preview.approvedPlanId}:${taskId}`]
        return next
      })
    }
  }
  return <section aria-label="Vínculos explícitos entre Backlog y DAG"
    className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
    <h3 className="text-sm font-semibold">Backlog ↔ tareas de Atlas</h3>
    <p className="text-muted-foreground">
      Asociación manual y auditable. No cambia estados de historias, inicia agentes,
      verifica QA ni convierte declaraciones externas en evidencia del host.
    </p>
    {!preview.approvedPlanId ? <p>Aprueba un plan de Atlas para vincular tareas.</p> :
      <div className="space-y-2">
        <p>Plan aprobado: {preview.approvedPlanId} · {preview.unlinkedTaskCount} tareas sin historia</p>
        <div aria-label="Evidencia por historia (solo lectura)"
          className="space-y-1 rounded border border-border p-2">
          <p className="font-medium">Proyección de evidencias por historia</p>
          {evidence.stories.filter(story => story.linkedTaskCount > 0).map(story =>
            <p key={story.storyId} className="break-words text-muted-foreground">
              {story.storyId}: {story.linkedTaskCount} vinculadas ·
              {' '}{story.plannedOrUnverifiedCount} planificadas/sin verificar ·
              {' '}{story.awaitingQaCount} en espera de QA ·
              {' '}{story.qaApprovedDeclaredCount} QA aprobado (declarado) ·
              {' '}{story.blockedOrCorrectionsCount} bloqueadas/con correcciones ·
              {' '}Backlog manual: {story.backlogStatus}
            </p>)}
          {!evidence.stories.some(story => story.linkedTaskCount > 0) &&
            <p className="text-muted-foreground">Aún no hay tareas vinculadas.</p>}
          <p className="text-muted-foreground">
            Los recuentos no son comprobaciones de CI y no actualizan los estados del Backlog.
          </p>
        </div>
        {current.map(task => <div key={task.id} className="rounded border border-border p-2">
          <p className="font-medium">{task.id} · {task.title} ({task.role})</p>
          <p className="mb-2 text-muted-foreground">
            Estado de evidencia: {task.stage} · no es un estado de Backlog
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1 space-y-1">
              Historia vinculada
              <select aria-label={`Historia para ${task.id}`}
                className="w-full rounded border border-border bg-background p-2"
                disabled={busy || (doc.taskLinks?.length ?? 0) >= 100}
                value={task.target}
                onChange={event => setDraft(previous => ({
                  ...previous,
                  [`${doc.projectId}:${preview.approvedPlanId}:${task.id}`]: event.target.value
                }))}>
                <option value="">Sin vínculo</option>
                {stories.map(item => <option key={item.id} value={item.id}>
                  {item.id} · {item.title}
                </option>)}
                {historicalStories.map(item => <option key={item.id} value={item.id}
                  disabled={task.storyId !== item.id}>
                  {item.id} · {item.title} (quitada del backlog)
                </option>)}
              </select>
            </label>
            <button type="button" className="rounded bg-muted px-3 py-2 disabled:opacity-40"
              disabled={busy || (doc.taskLinks?.length ?? 0) >= 100 ||
                task.target === (task.storyId ?? '')}
              onClick={() => void linkTask(task.id, task.target)}>
              Registrar vínculo
            </button>
          </div>
        </div>)}
        <p className="text-muted-foreground">
          Cada corrección añade un evento al historial. Una relación nunca implica que
          la historia esté terminada ni que todas sus tareas hayan pasado QA.
        </p>
      </div>}
  </section>
}
