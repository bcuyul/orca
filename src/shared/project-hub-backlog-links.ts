/** Explicit, append-only linkage between stories and approved Atlas DAG tasks.
 * Linkage only: it never changes backlog state or proves execution, QA or CI. */
import type { HubDocument, HubStatus } from './project-hub-types'
import { projectHubHandoffReadiness, type HubHandoffStage } from './project-hub-handoff-readiness'

export type HubTaskLinkEvent = {
  id: string
  planId: string
  taskId: string
  storyId: string | null
  at: string
}

type LinkDocument = Pick<HubDocument, 'items' | 'intelligence' | 'taskLinks'>
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/
const atValid = (s: unknown): s is string =>
  typeof s === 'string' && s.length <= 50 && /^\d{4}-\d\d-\d\dT/.test(s)

/** Fail closed on invalid references and event order, including attempts to forge links. */
export function isHubTaskLinkHistory(doc: LinkDocument): boolean {
  const events = doc.taskLinks
  if (events === undefined) { return true }
  if (!Array.isArray(events) || events.length > 100) { return false }
  const ids = new Set<string>()
  const stories = new Set(doc.items.filter(item => item.type === 'story').map(item => item.id))
  const plans = doc.intelligence?.plans ?? []
  const accepted = new Set((doc.intelligence?.decisions ?? []).filter(decision =>
    decision.subject === 'plan' && decision.verdict === 'accepted'
  ).map(decision => decision.subjectId))
  const current = new Map<string, string | null>()
  for (const item of events) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id) ||
        typeof item.planId !== 'string' || !ID.test(item.planId) ||
        typeof item.taskId !== 'string' || !ID.test(item.taskId) || !atValid(item.at) ||
        (item.storyId !== null &&
          (typeof item.storyId !== 'string' || !stories.has(item.storyId)))) { return false }
    const plan = plans.find(plan => plan.id === item.planId)
    if (!plan || !accepted.has(item.planId) ||
        !plan.tasks.some(task => task.id === item.taskId)) { return false }
    const key = `${item.planId}:${item.taskId}`
    if (item.storyId === (current.get(key) ?? null)) { return false }
    ids.add(item.id)
    current.set(key, item.storyId)
  }
  return true
}

/** Immutable audit: correction or unlink must append a new event. */
export function isHubTaskLinkTransition(
  before: readonly HubTaskLinkEvent[] = [],
  after: readonly HubTaskLinkEvent[] = []
): boolean {
  return after.length >= before.length &&
    before.every((item, index) => JSON.stringify(item) === JSON.stringify(after[index]))
}

export type HubTaskStoryRow = {
  id: string
  title: string
  role: string
  stage: HubHandoffStage
  storyId: string | null
}

export type HubBacklogLinkProjection = {
  approvedPlanId: string | null
  tasks: HubTaskStoryRow[]
  unlinkedTaskCount: number
  executionAuthorized: false
  autoStatusSync: false
}

/** Same-project projection, always read-only, with explicit and never inferred links. */
export function projectHubBacklogLinks(doc: HubDocument): HubBacklogLinkProjection {
  const accepted = new Set((doc.intelligence?.decisions ?? []).filter(decision =>
    decision.subject === 'plan' && decision.verdict === 'accepted'
  ).map(decision => decision.subjectId))
  const plan = doc.intelligence?.plans.findLast(plan => accepted.has(plan.id))
  if (!plan || !doc.intelligence) {
    return { approvedPlanId: null, tasks: [], unlinkedTaskCount: 0,
      executionAuthorized: false, autoStatusSync: false }
  }
  const links = new Map<string, string | null>()
  for (const item of doc.taskLinks ?? []) {
    if (item.planId === plan.id) { links.set(item.taskId, item.storyId) }
  }
  const validStories = new Set(doc.items.filter(item => item.type === 'story').map(item => item.id))
  const readiness = projectHubHandoffReadiness(doc.intelligence, plan.id)
  const tasks = readiness.tasks.map(task => ({
    id: task.id, title: task.title, role: task.role, stage: task.stage,
    storyId: validStories.has(links.get(task.id) ?? '') ? links.get(task.id)! : null
  }))
  return {
    approvedPlanId: plan.id, tasks,
    unlinkedTaskCount: tasks.filter(task => task.storyId === null).length,
    executionAuthorized: false, autoStatusSync: false
  }
}

/** Per-story diagnostic projection. No status transitions or verified execution claims. */
export type HubStoryEvidenceRow = {
  storyId: string
  title: string
  backlogStatus: HubStatus
  linkedTaskCount: number
  plannedOrUnverifiedCount: number
  awaitingQaCount: number
  qaApprovedDeclaredCount: number
  blockedOrCorrectionsCount: number
}
export type HubStoryEvidenceProjection = {
  approvedPlanId: string | null
  stories: HubStoryEvidenceRow[]
  unlinkedTaskCount: number
  executionAuthorized: false
  autoStatusSync: false
}

/** Aggregate only explicitly linked tasks of the latest accepted plan, in O(stories+tasks). */
export function projectHubStoryEvidence(doc: HubDocument): HubStoryEvidenceProjection {
  const projection = projectHubBacklogLinks(doc)
  const rows = doc.items.filter(item => item.type === 'story').map(item => ({
    storyId: item.id, title: item.title, backlogStatus: item.status,
    linkedTaskCount: 0, plannedOrUnverifiedCount: 0,
    awaitingQaCount: 0, qaApprovedDeclaredCount: 0, blockedOrCorrectionsCount: 0
  }))
  const byId = new Map(rows.map(item => [item.storyId, item]))
  for (const task of projection.tasks) {
    if (!task.storyId) { continue }
    const story = byId.get(task.storyId)
    if (!story) { continue }
    story.linkedTaskCount++
    if (task.stage === 'blocked' || task.stage === 'changes_requested') {
      story.blockedOrCorrectionsCount++
    } else if (task.stage === 'qa_approved_attested') {
      story.qaApprovedDeclaredCount++
    } else if (task.stage === 'awaiting_qa' || task.stage === 'qa_inconclusive') {
      story.awaitingQaCount++
    } else {
      story.plannedOrUnverifiedCount++
    }
  }
  return {
    approvedPlanId: projection.approvedPlanId,
    stories: rows,
    unlinkedTaskCount: projection.unlinkedTaskCount,
    executionAuthorized: false, autoStatusSync: false
  }
}
