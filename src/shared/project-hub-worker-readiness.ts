import type { NativePlanPreview } from './native-plan-preview'
import type { HubNativeStageRecovery } from './project-hub-supervised-stage'

/**
 * Advisory, read-only display projection. Never use it as an IPC/host execution
 * gate: native Run/Task staging alone cannot authenticate consent or Dispatch.
 */
export type HubWorkerReadiness = {
  status: 'blocked' | 'candidates-only'
  runId: string | null
  candidates: { taskId: string; nativeTaskId: string; title: string; role: string }[]
  waiting: { taskId: string; dependsOn: string[] }[]
  reasons: string[]
  executionAuthorized: false
  dispatchAllowed: false
}

const HOST_GATES = [
  'Falta aprobación independiente y autenticada del host para ejecutar un worker.',
  'Faltan la reserva durable de presupuesto y la admisión atómica de Dispatch.',
  'Falta verificar CLI, sandbox, sesión y Git inmediatamente antes del lanzamiento.'
] as const

function blocked(reason: string): HubWorkerReadiness {
  return {
    status: 'blocked', runId: null, candidates: [], waiting: [],
    reasons: [reason, ...HOST_GATES],
    executionAuthorized: false, dispatchAllowed: false
  }
}

/**
 * A valid staged Run can identify dependency-free *candidates*, NOT runnable
 * workers. No completed-task evidence exists in a staged plan, so descendants
 * cannot be considered ready. This function neither reads nor writes the host.
 */
export function evaluateHubWorkerReadiness(
  preview: NativePlanPreview | null,
  recovery: HubNativeStageRecovery | null
): HubWorkerReadiness {
  if (!preview || preview.approval !== 'accepted' || preview.dispatched !== false ||
      preview.tasks.length === 0) {
    return blocked('No hay un DAG aprobado y válido para preparar un worker.')
  }
  if (!recovery || recovery.status !== 'completed_verified' ||
      recovery.executionAuthorized !== false || recovery.entries.length !== 1) {
    return blocked('No existe un único Run confirmado; concilia los recibos del host.')
  }
  const entry = recovery.entries[0]!
  if (entry.disposition !== 'completed_verified' ||
      entry.state !== 'completed' || entry.evidence !== 'matched' ||
      typeof entry.runId !== 'string' || !entry.runId.trim() ||
      !/^[a-f0-9]{40}$/i.test(entry.baseSha) ||
      !entry.tasks || entry.dispatchCount !== 0 ||
      entry.unrecordedNativeTaskCount !== 0 ||
      entry.recordedTaskCount !== preview.tasks.length) {
    return blocked('La evidencia nativa no acredita un DAG staged íntegro y sin Dispatch.')
  }
  const taskIds = new Set(preview.tasks.map(task => task.id))
  const entries = Object.entries(entry.tasks)
  if (taskIds.size !== preview.tasks.length || entries.length !== taskIds.size ||
      entries.some(([id, nativeId]) => !taskIds.has(id) ||
        typeof nativeId !== 'string' || nativeId.trim().length === 0) ||
      new Set(entries.map(([, nativeId]) => nativeId)).size !== entries.length ||
      preview.tasks.some(task => task.dependsOn.some(dep => !taskIds.has(dep) || dep === task.id))) {
    return blocked('Los identificadores o dependencias del DAG no coinciden con el recibo nativo.')
  }
  const candidates: HubWorkerReadiness['candidates'] = []
  const waiting: HubWorkerReadiness['waiting'] = []
  for (const task of preview.tasks) {
    if (task.dependsOn.length > 0) {
      waiting.push({ taskId: task.id, dependsOn: [...task.dependsOn] })
    } else {
      candidates.push({
        taskId: task.id, nativeTaskId: entry.tasks[task.id]!,
        title: task.title, role: task.role
      })
    }
  }
  if (candidates.length === 0) {
    return blocked('Ninguna tarea raíz disponible; revisar las dependencias del DAG.')
  }
  return {
    status: 'candidates-only', runId: entry.runId,
    candidates, waiting, reasons: [...HOST_GATES],
    executionAuthorized: false, dispatchAllowed: false
  }
}
