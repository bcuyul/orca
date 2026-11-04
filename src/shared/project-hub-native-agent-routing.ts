/** Native agent inventory -> approved Atlas DAG routing candidates.
 * Candidate is not proof of capability, session safety or execution authority. */
import type { TuiAgent } from './tui-agent'
import { filterEnabledTuiAgents, TUI_AGENT_AUTO_PICK_ORDER } from './tui-agent-selection'
import type { HubDocument } from './project-hub-types'
import type { HubPlanTask } from './project-hub-intelligence'

export type NativeAgentInventoryStatus =
  'pending' | 'successful' | 'failed' | 'unsupported-host'

export type NativeRoutingTask = Pick<HubPlanTask, 'id' | 'title' | 'role' | 'dependsOn'> & {
  agentCandidates: TuiAgent[]
  placement: 'reconcile-first'
  reason: string
  executionAuthorized: false
}

export type NativeRoutingPreview = {
  inventoryStatus: NativeAgentInventoryStatus
  installedAgents: TuiAgent[]
  approvedPlanId: string | null
  tasks: NativeRoutingTask[]
  executionAuthorized: false
  hostSessionEvidenceVerified: false
}

/** Pure bounded projection with no IPC, process launch, permissions or state changes. */
export function previewNativeAgentRouting(
  doc: HubDocument,
  inventoryStatus: NativeAgentInventoryStatus,
  detectedAgents: readonly TuiAgent[] | null,
  disabledAgents: readonly TuiAgent[] = []
): NativeRoutingPreview {
  const installedAgents = inventoryStatus === 'successful' && detectedAgents
    ? filterEnabledTuiAgents(
      TUI_AGENT_AUTO_PICK_ORDER.filter(agent => detectedAgents.includes(agent)),
      disabledAgents
    )
    : []
  const acceptedIds = new Set((doc.intelligence?.decisions ?? []).filter(decision =>
    decision.subject === 'plan' && decision.verdict === 'accepted'
  ).map(decision => decision.subjectId))
  const acceptedPlan = doc.intelligence?.plans.findLast(plan =>
    acceptedIds.has(plan.id)) ?? null
  const tasks: NativeRoutingTask[] = (acceptedPlan?.tasks ?? []).map(task => ({
    id: task.id,
    title: task.title,
    role: task.role,
    dependsOn: [...task.dependsOn],
    agentCandidates: [...installedAgents],
    placement: 'reconcile-first',
    reason: inventoryStatus !== 'successful'
      ? 'El inventario del host no está confirmado'
      : installedAgents.length === 0
        ? 'No hay agentes habilitados detectados en el contexto seleccionado'
        : 'Falta comprobar capacidades, Git HEAD y estado, identidad y contexto de sesión, permisos y sandbox del host',
    executionAuthorized: false
  }))
  return {
    inventoryStatus,
    installedAgents,
    approvedPlanId: acceptedPlan?.id ?? null,
    tasks,
    executionAuthorized: false,
    hostSessionEvidenceVerified: false
  }
}
