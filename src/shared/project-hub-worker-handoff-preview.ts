/** Dry-run only: produce a bounded human-readable handoff for ONE verified
 * native root task. The proposal does not select a session or admit execution.
 */
import type { HubDocument } from './project-hub-types'
import type { NativePlanPreview } from './native-plan-preview'
import type { HubWorkerReadiness } from './project-hub-worker-readiness'
import type { HubDispatchRecoveryReport } from './project-hub-worker-dispatch-recovery'
import type { NativeAgentInventoryStatus } from './project-hub-native-agent-routing'
import type { TuiAgent } from './tui-agent'
import { filterEnabledTuiAgents, pickTuiAgent, TUI_AGENT_AUTO_PICK_ORDER } from './tui-agent-selection'
import { renderForgeImplementationPrompt } from './project-hub-intelligence-prompts'

export type HubWorkerHandoffPreview = {
  status: 'blocked' | 'draft-only'
  runId: string | null
  taskId: string | null
  nativeTaskId: string | null
  baseSha: string | null
  selectedAgent: TuiAgent | null
  agentOptions: TuiAgent[]
  waitingFor: { taskId: string; dependsOn: string[] }[]
  blockers: string[]
  prompt: string | null
  executionAuthorized: false
  sessionVerified: false
  modelCalls: 0
}

export type HubWorkerHandoffInput = {
  document: HubDocument
  preview: NativePlanPreview | null
  readiness: HubWorkerReadiness
  dispatchRecovery: HubDispatchRecoveryReport | null
  baseSha: string | null
  inventoryStatus: NativeAgentInventoryStatus
  detectedAgents: readonly TuiAgent[] | null
  disabledAgents?: readonly TuiAgent[]
  preferredAgent?: TuiAgent | null
}

const GATES = [
  'El borrador no acredita una sesión autenticada, sandbox OS ni cuota del proveedor.',
  'La aprobación de un DAG NO es permiso para lanzar o reenviar un agente.'
] as const

export function previewHubWorkerHandoff(input: HubWorkerHandoffInput): HubWorkerHandoffPreview {
  const candidates = input.readiness.candidates
  const task = candidates.length === 1 ? candidates[0]! : null
  const root = input.preview?.tasks.find(t => t.id === task?.taskId)
  const plan = input.document.intelligence?.plans.find(p => p.id === input.preview?.planId)
  const enabled = input.inventoryStatus === 'successful' && input.detectedAgents
    ? filterEnabledTuiAgents(
      TUI_AGENT_AUTO_PICK_ORDER.filter(a => input.detectedAgents?.includes(a)),
      input.disabledAgents ?? []
    ) : []
  const selected = input.preferredAgent
    ? enabled.includes(input.preferredAgent) ? input.preferredAgent : null
    : pickTuiAgent(null, enabled)
  const blockers: string[] = []

  if (!input.preview || input.preview.projectId !== input.document.projectId ||
      input.preview.revision !== input.document.revision ||
      !plan || input.preview.approval !== 'accepted' ||
      !input.document.intelligence?.decisions.some(d => d.subject === 'plan' &&
        d.subjectId === plan.id && d.verdict === 'accepted')) {
    blockers.push('Falta un plan aprobado y una vista previa vigente.')
  }
  if (input.readiness.status !== 'candidates-only' || !input.readiness.runId ||
      !task || !root || !['forge', 'flow', 'data'].includes(root.role) ||
      root.dependsOn.length !== 0 || root.role !== task.role ||
      root.title !== task.title) {
    blockers.push('Falta una única tarea raíz de implementación verificada en SQLite.')
  }
  if (!input.baseSha || !/^[a-f0-9]{40}$/i.test(input.baseSha)) {
    blockers.push('Falta un SHA base del worktree verificado por el host.')
  }
  if (!input.dispatchRecovery || input.dispatchRecovery.status !== 'not_found' ||
      input.dispatchRecovery.entries.length !== 0) {
    blockers.push('Inspecciona los recibos de Dispatch; cualquier estado incierto bloquea el traspaso.')
  }
  if (input.inventoryStatus !== 'successful' || enabled.length === 0) {
    blockers.push('Falta inventario confirmado de CLI habilitados para este worktree.')
  }
  if (input.preferredAgent && !enabled.includes(input.preferredAgent)) {
    blockers.push('El CLI elegido no está disponible o está deshabilitado.')
  }

  let prompt: string | null = null
  if (blockers.length === 0 && plan && root && task && input.baseSha &&
      input.readiness.runId && selected) {
    // Existing renderer-safe handoff escapes untrusted task data and bounds it.
    const body = renderForgeImplementationPrompt(
      input.document, plan, root.id, input.baseSha
    )
    const header = [
      '# Project Hub native Run/Task routing proposal (copy only)',
      `Run: ${input.readiness.runId}`,
      `Native Task: ${task.nativeTaskId}`,
      `Suggested CLI: ${selected} (inventory advisory, not a verified session)`,
      'No CLI launch, Dispatch, model call, Git write or permission comes from this text.',
      'The independent host consent + sandbox + token budget remain mandatory.'
    ].join('\n')
    prompt = `${header}\n\n${body}`
  }
  return {
    status: prompt ? 'draft-only' : 'blocked',
    runId: input.readiness.runId,
    taskId: task?.taskId ?? null,
    nativeTaskId: task?.nativeTaskId ?? null,
    baseSha: input.baseSha,
    selectedAgent: selected,
    agentOptions: enabled,
    waitingFor: input.readiness.waiting.map(t => ({
      taskId: t.taskId, dependsOn: [...t.dependsOn]
    })),
    blockers: [...blockers, ...GATES],
    prompt,
    executionAuthorized: false,
    sessionVerified: false,
    modelCalls: 0
  }
}
