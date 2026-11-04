/** Read-only Project Hub overview. No inferred Run, Dispatch, CI or permission grant. */
import type { HubDocument } from './project-hub-types'
import type { HubImplementationEvidence, HubQualityReview } from './project-hub-intelligence'
import {
  projectHubHandoffReadiness, type HubHandoffTask
} from './project-hub-handoff-readiness'

export type HubOverviewEvent = {
  id: string
  kind: 'plan' | 'implementation' | 'review'
  title: string
  description: string
  at: string
  /** All events are declarations, never authenticated runtime receipts. */
  provenance: 'human-declared' | 'external-unverified'
}
export type HubOverview = {
  backlog: { total: number; ready: number; done: number; review: number; blocked: number }
  plans: { total: number; accepted: number }
  implementations: number
  /** Includes legacy manual QA; linked counts only reviews tied to an implementation. */
  historicalReviews: number
  linkedReviews: number
  activePlan: {
    id: string
    objective: string
    accepted: boolean
    tasks: HubHandoffTask[]
    awaitingDelivery: number
    awaitingQa: number
    qaAttested: number
    blocked: number
  } | null
  recentActivity: HubOverviewEvent[]
  /** A renderer projection never proves execution, CI or host authorization. */
  executionAuthorized: false
  ciVerifiedByThisProjection: false
}

/**
 * Derive all cards from the same persisted document without writes or cross-project queries.
 * Processing is bounded by the schema and linear in the evidence arrays, plus a small
 * chronological sort for the activity display.
 */
export function projectHubOverview(doc: HubDocument): HubOverview {
  const state = doc.intelligence
  const backlog = {
    total: doc.items.length,
    ready: 0, done: 0, review: 0, blocked: 0
  }
  for (const item of doc.items) {
    if (item.status === 'ready') { backlog.ready++ }
    if (item.status === 'done') { backlog.done++ }
    if (item.status === 'review') { backlog.review++ }
    if (item.status === 'blocked') { backlog.blocked++ }
  }

  const approvedIds = new Set((state?.decisions ?? []).filter(d =>
    d.subject === 'plan' && d.verdict === 'accepted'
  ).map(d => d.subjectId))
  const plans = state?.plans ?? []
  const selectedPlan = plans.findLast(plan => approvedIds.has(plan.id)) ??
    plans.at(-1) ?? null
  const readiness = state && selectedPlan ?
    projectHubHandoffReadiness(state, selectedPlan.id) : null

  const reports = state?.implementations ?? []
  const reportsById = new Map<string, HubImplementationEvidence>(
    reports.map(report => [report.id, report])
  )
  const reviews = state?.reviews ?? []
  let linkedReviews = 0
  for (const review of reviews) {
    if (review.implementationId && reportsById.has(review.implementationId)) { linkedReviews++ }
  }

  const activity: (HubOverviewEvent & { order: number })[] = []
  function add(event: HubOverviewEvent): void {
    activity.push({ ...event, order: activity.length })
  }
  for (const decision of state?.decisions ?? []) {
    if (decision.subject !== 'plan') { continue }
    const plan = plans.find(p => p.id === decision.subjectId)
    add({
      id: decision.id, kind: 'plan', at: decision.createdAt,
      title: decision.verdict === 'accepted' ? 'Plan aprobado manualmente' : 'Plan rechazado manualmente',
      description: plan?.objective ?? decision.subjectId,
      provenance: 'human-declared'
    })
  }
  for (const report of reports) {
    add({
      id: report.id, kind: 'implementation', at: report.createdAt,
      title: 'Entrega externa declarada',
      description: `${report.taskId} · ${report.headSha.slice(0, 12)}` +
        (report.previousImplementationId ? ' · nueva versión' : ''),
      provenance: 'external-unverified'
    })
  }
  const verdictNames: Record<HubQualityReview['verdict'], string> = {
    approved: 'QA aprobó (declarado)',
    'changes-requested': 'QA solicita correcciones (declarado)',
    inconclusive: 'QA inconcluso (declarado)'
  }
  for (const review of reviews) {
    const report = review.implementationId ? reportsById.get(review.implementationId) : undefined
    add({
      id: review.id, kind: 'review', at: review.createdAt,
      title: verdictNames[review.verdict],
      description: `${review.taskId} · ${report?.headSha.slice(0, 12) ?? 'sin entrega vinculada'}`,
      provenance: 'human-declared'
    })
  }
  activity.sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order)

  return {
    backlog,
    plans: { total: plans.length, accepted: approvedIds.size },
    implementations: reports.length,
    historicalReviews: reviews.length,
    linkedReviews,
    activePlan: selectedPlan && readiness ? {
      id: selectedPlan.id, objective: selectedPlan.objective,
      accepted: readiness.approvedByHuman,
      tasks: readiness.tasks,
      awaitingDelivery: readiness.awaitingDelivery,
      awaitingQa: readiness.awaitingQa,
      qaAttested: readiness.qaAttested,
      blocked: readiness.blocked
    } : null,
    recentActivity: activity.slice(0, 8).map(({ order: _order, ...event }) => event),
    executionAuthorized: false,
    ciVerifiedByThisProjection: false
  }
}
