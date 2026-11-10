import type { HubDocument } from './project-hub-types'
import { isHubPlanProposal, type HubPlanProposal } from './project-hub-intelligence'

/** Deterministic, token-free proposal. This is NOT an Atlas/AI review or approval. */
export type HubBacklogDagRequest = {
  storyId: string
  planId: string
  createdAt: string
  implementationRole: 'forge' | 'data' | 'flow'
}

export function buildHubBacklogDagTemplate(
  document: HubDocument,
  request: HubBacklogDagRequest
): HubPlanProposal {
  if (document.intelligence?.plans.length && document.intelligence.plans.length >= 30) {
    throw new Error('Project Hub plan limit reached')
  }
  if (!['forge','data','flow'].includes(request.implementationRole) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(request.planId) ||
      !/^\d{4}-\d\d-\d\dT/.test(request.createdAt) ||
      !Number.isFinite(Date.parse(request.createdAt))) {
    throw new Error('Invalid deterministic plan configuration')
  }
  const item = document.items.find(story => story.id === request.storyId)
  if (!item || !['backlog', 'ready'].includes(item.status)) {
    throw new Error('Backlog item is missing or already in progress')
  }
  if (item.acceptance.trim().length < 5) {
    throw new Error('Add acceptance criteria to the backlog item before planning')
  }
  const objective = `${item.id}: ${item.title.trim()}`
  if (document.intelligence?.plans.some(plan => plan.objective === objective)) {
    throw new Error('This backlog item already has a proposed DAG; review it first')
  }

  const roleLabel = request.implementationRole === 'data' ? 'Datos' :
    request.implementationRole === 'flow' ? 'Automatización' : 'Desarrollo'
  const details = item.description.trim()
  const rationale = [
    `Borrador determinista de backlog ${item.id} (${item.type}).`,
    `Ruta declarada por el usuario: ${roleLabel} → QA independiente.`,
    'Sin IA, no ejecuta agentes, no verifica CI. Revisar el alcance antes de aprobar.',
    ...(details ? [`Contexto de la historia: ${details.slice(0,1200)}`] : [])
  ].join(' ')
  const criteria = item.acceptance.trim()
  const proposal: HubPlanProposal = {
    id: request.planId, objective, rationale,
    source: 'human', createdAt: request.createdAt,
    tasks: [
      {
        id: 'implement',
        title: `${roleLabel}: ${item.title.trim()}`.slice(0,160),
        role: request.implementationRole, dependsOn: [],
        acceptance: `Criterios de la historia ${item.id}: ${criteria}`.slice(0,2000)
      },
      {
        id: 'review',
        title: `QA independiente: ${item.title.trim()}`.slice(0,160),
        role: 'qa', dependsOn: ['implement'],
        acceptance: [
          'Inspeccionar diff, pruebas reales y criterios; registrar hallazgos.',
          'No aceptar como verificados resultados declarados sin evidencia.',
          `Criterios: ${criteria.slice(0,1200)}`
        ].join(' ').slice(0,2000)
      }
    ]
  }
  if (!isHubPlanProposal(proposal)) {
    throw new Error('Generated DAG does not meet Project Hub validation rules')
  }
  return proposal
}
