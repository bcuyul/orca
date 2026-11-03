import type {
  HubImplementationEvidence, HubIntelligence, HubQualityReview
} from './project-hub-intelligence'

export type HubHandoffStage =
  'plan_not_accepted' | 'role_only' | 'awaiting_external_delivery' |
  'awaiting_qa' | 'changes_requested' | 'qa_inconclusive' |
  'qa_approved_attested' | 'blocked'

export type HubHandoffTask = {
  id: string
  title: string
  role: string
  dependsOn: string[]
  stage: HubHandoffStage
  /** Last external statement, never an authenticated agent receipt. */
  implementation: HubImplementationEvidence | null
  qaReview: HubQualityReview | null
}

export type HubHandoffProjection = {
  planId: string
  approvedByHuman: boolean
  total: number
  awaitingDelivery: number
  awaitingQa: number
  qaAttested: number
  blocked: number
  tasks: HubHandoffTask[]
  /** An evidence projection is not a grant, dispatch or execution capability. */
  executable: false
}

/**
 * O(plans + decisions + blockers + implementations + reviews + tasks).
 * Index report and QA records once, not once per card on each renderer update.
 * A fresh implementation invalidates previous QA for the same task.
 */
export function projectHubHandoffReadiness(
  state: HubIntelligence, planId: string
): HubHandoffProjection {
  const plan = state.plans.find(candidate => candidate.id === planId)
  if (!plan) { throw new Error('Unknown plan') }
  const accepted = state.decisions.some(decision =>
    decision.subject === 'plan' && decision.subjectId === planId &&
    decision.verdict === 'accepted')
  const latest = new Map<string, HubImplementationEvidence>()
  for (const implementation of state.implementations ?? []) {
    if (implementation.planId === planId) { latest.set(implementation.taskId, implementation) }
  }
  const reviews = new Map<string, HubQualityReview>()
  for (const review of state.reviews) {
    if (review.planId === planId && review.implementationId) {
      reviews.set(review.implementationId, review)
    }
  }
  const blockers = new Set(state.blockers.filter(b => b.planId === planId).map(b => b.taskId))
  let awaitingDelivery = 0, awaitingQa = 0, qaAttested = 0, blocked = 0
  const tasks: HubHandoffTask[] = plan.tasks.map(task => {
    const implementation = latest.get(task.id) ?? null
    const qaReview = implementation ? reviews.get(implementation.id) ?? null : null
    let stage: HubHandoffStage
    if (!accepted) { stage = 'plan_not_accepted' }
    else if (blockers.has(task.id)) { stage = 'blocked'; blocked++ }
    else if (task.role === 'atlas' || task.role === 'qa') { stage = 'role_only' }
    else if (!implementation) { stage = 'awaiting_external_delivery'; awaitingDelivery++ }
    else if (!qaReview) { stage = 'awaiting_qa'; awaitingQa++ }
    else if (qaReview.verdict === 'approved') { stage = 'qa_approved_attested'; qaAttested++ }
    else if (qaReview.verdict === 'changes-requested') { stage = 'changes_requested'; blocked++ }
    else { stage = 'qa_inconclusive'; awaitingQa++ }
    return { id: task.id, title: task.title, role: task.role, dependsOn: task.dependsOn,
      stage, implementation, qaReview }
  })
  return { planId, approvedByHuman: accepted, total: tasks.length, awaitingDelivery,
    awaitingQa, qaAttested, blocked, tasks, executable: false }
}
