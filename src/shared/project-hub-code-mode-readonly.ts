import {
  isHubDocument, PROJECT_HUB_STATUSES,
  type HubDocument, type HubStatus
} from './project-hub-types'

export const HUB_CODE_MODE_READ_TOOLS = [
  'hub.backlog.summary',
  'hub.plans.summary',
  'hub.delegations.summary'
] as const

export type HubCodeModeReadTool = (typeof HUB_CODE_MODE_READ_TOOLS)[number]
export type HubCodeModeStep = {
  tool: HubCodeModeReadTool
  result: Record<string, unknown>
}
export type HubCodeModeReport = {
  status: 'complete' | 'blocked'
  projectId: string
  revision: number | null
  steps: HubCodeModeStep[]
  blockers: string[]
  toolCalls: number
  externalCalls: 0
  modelCalls: 0
  executionAuthorized: false
  generatedCodeExecuted: false
}

export const HUB_CODE_MODE_TOOL_CATALOG: readonly {
  id: HubCodeModeReadTool
  description: string
}[] = [
  { id: 'hub.backlog.summary', description: 'Conteos del backlog activo y archivado' },
  { id: 'hub.plans.summary', description: 'Planes, tareas y decisiones humanas registradas' },
  { id: 'hub.delegations.summary', description: 'Reservas de delegación, sin inferir finalización' }
]

export function searchHubCodeModeTools(query: string): typeof HUB_CODE_MODE_TOOL_CATALOG {
  const term = query.trim().toLowerCase().slice(0, 80)
  return HUB_CODE_MODE_TOOL_CATALOG.filter(tool =>
    !term || tool.id.includes(term) || tool.description.toLowerCase().includes(term))
}

function backlogSummary(doc: HubDocument): Record<string, unknown> {
  const byStatus: Record<HubStatus, number> = {
    backlog: 0, ready: 0, doing: 0, review: 0, blocked: 0, done: 0
  }
  let archived = 0
  for (const item of doc.items) {
    if (item.archived) { archived++; continue }
    byStatus[item.status]++
  }
  return {
    active: doc.items.length - archived,
    archived,
    byStatus: Object.fromEntries(PROJECT_HUB_STATUSES.map(status => [status, byStatus[status]]))
  }
}

function planSummary(doc: HubDocument): Record<string, unknown> {
  const state = doc.intelligence
  if (!state) {
    return { plans: 0, tasks: 0, acceptedPlans: 0, blockerRecords: 0, reviews: 0 }
  }
  const accepted = new Set(state.decisions.filter(decision =>
    decision.subject === 'plan' && decision.verdict === 'accepted'
  ).map(decision => decision.subjectId))
  return {
    plans: state.plans.length,
    tasks: state.plans.reduce((sum, plan) => sum + plan.tasks.length, 0),
    acceptedPlans: state.plans.filter(plan => accepted.has(plan.id)).length,
    blockerRecords: state.blockers.length,
    reviews: state.reviews.length
  }
}

function delegationSummary(doc: HubDocument): Record<string, unknown> {
  const byStatus = { planned: 0, launching: 0, launched: 0, unconfirmed: 0 }
  for (const row of doc.delegations ?? []) { byStatus[row.status]++ }
  return { total: doc.delegations?.length ?? 0, byStatus,
    note: 'launched only proves initial handoff; unconfirmed must never be retried automatically' }
}

function readTool(doc: HubDocument, id: HubCodeModeReadTool): Record<string, unknown> {
  switch (id) {
    case 'hub.backlog.summary': return backlogSummary(doc)
    case 'hub.plans.summary': return planSummary(doc)
    case 'hub.delegations.summary': return delegationSummary(doc)
  }
}

/** Trusted bundled recipe only. No eval, VM, network, filesystem, IPC, CLI or model calls. */
export function runHubCodeModeReadOnly(
  document: HubDocument,
  expectedProjectId: string,
  selectedTools: readonly HubCodeModeReadTool[] = HUB_CODE_MODE_READ_TOOLS
): HubCodeModeReport {
  const blocked = (reason: string): HubCodeModeReport => ({
    status: 'blocked', projectId: expectedProjectId, revision: null, steps: [],
    blockers: [reason], toolCalls: 0, externalCalls: 0,
    modelCalls: 0, executionAuthorized: false, generatedCodeExecuted: false
  })
  if (!expectedProjectId || !isHubDocument(document) ||
    document.projectId !== expectedProjectId) {
    return blocked('Falta un documento válido del proyecto seleccionado.')
  }
  if (selectedTools.length < 1 || selectedTools.length > HUB_CODE_MODE_READ_TOOLS.length ||
    new Set(selectedTools).size !== selectedTools.length ||
    selectedTools.some(tool => !HUB_CODE_MODE_READ_TOOLS.includes(tool))) {
    return blocked('La receta solicita herramientas desconocidas o repetidas.')
  }

  // Every result is an aggregate of the already authenticated project snapshot.
  const steps = selectedTools.map(tool => ({ tool, result: readTool(document, tool) }))
  return {
    status: 'complete', projectId: expectedProjectId, revision: document.revision,
    steps, blockers: [], toolCalls: steps.length, externalCalls: 0,
    modelCalls: 0, executionAuthorized: false, generatedCodeExecuted: false
  }
}
