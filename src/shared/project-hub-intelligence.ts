/** Append-only, project-scoped intelligence proposals.
 * This layer never executes agents or asserts CI/sessions have been verified. */
export type HubPlanTask = {
  id: string
  title: string
  role: 'atlas' | 'forge' | 'flow' | 'data' | 'qa'
  dependsOn: string[]
  acceptance: string
}
export type HubPlanProposal = {
  id: string
  objective: string
  rationale: string
  source: 'atlas-proposal' | 'human'
  tasks: HubPlanTask[]
  createdAt: string
  previousPlanId?: string
  blockerId?: string
}
export type HubBlocker = {
  id: string
  planId: string
  taskId: string
  observation: string
  recommendedAction: string
  createdAt: string
}
export type HubMemoryCandidate = {
  id: string
  lesson: string
  applicability: string
  evidenceRef: string
  createdAt: string
}
export type HubQualityReview = {
  id: string
  planId: string
  taskId: string
  reviewer: 'qa' | 'human'
  verdict: 'approved' | 'changes-requested' | 'inconclusive'
  evidenceRef: string
  findings: string
  createdAt: string
}
export type HubHumanDecision = {
  id: string
  subject: 'plan' | 'memory'
  subjectId: string
  verdict: 'accepted' | 'rejected'
  justification: string
  createdAt: string
}
export type HubIntelligence = {
  plans: HubPlanProposal[]
  blockers: HubBlocker[]
  memories: HubMemoryCandidate[]
  reviews: HubQualityReview[]
  decisions: HubHumanDecision[]
}

const identifier = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(s)
const content = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.trim().length >= 5 && s.length <= max
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const timestamp = (s: unknown): s is string =>
  typeof s === 'string' && s.length <= 50 && /^\d{4}-\d\d-\d\dT/.test(s)
const MAX = { plans: 30, blockers: 100, memories: 100, reviews: 100, decisions: 130 }
const roles = ['atlas', 'forge', 'flow', 'data', 'qa']
export const emptyHubIntelligence = (): HubIntelligence => ({
  plans: [], blockers: [], memories: [], reviews: [], decisions: []
})

/** Plan is a bounded DAG; cycles, unknown dependencies and duplicate task IDs fail closed. */
export function isHubPlanProposal(p: unknown): p is HubPlanProposal {
  if (!record(p) || !identifier(p.id) || !content(p.objective, 1200) ||
    !content(p.rationale, 2400) || !['atlas-proposal', 'human'].includes(String(p.source)) ||
    !timestamp(p.createdAt) || !Array.isArray(p.tasks) || p.tasks.length < 1 || p.tasks.length > 20 ||
    (p.previousPlanId !== undefined && !identifier(p.previousPlanId)) ||
    (p.blockerId !== undefined && !identifier(p.blockerId))) { return false }
  const ids = new Set<string>()
  const edges = new Map<string, string[]>()
  for (const t of p.tasks) {
    if (!record(t) || !identifier(t.id) || ids.has(t.id) || !content(t.title, 160) ||
      !roles.includes(String(t.role)) || !content(t.acceptance, 2000) ||
      !Array.isArray(t.dependsOn) || t.dependsOn.length > 19 ||
      t.dependsOn.some(d => !identifier(d)) ||
      new Set(t.dependsOn).size !== t.dependsOn.length) { return false }
    ids.add(t.id)
    edges.set(t.id, t.dependsOn)
  }
  if ([...edges.values()].some(ds => ds.some(d => !ids.has(d)))) { return false }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  function visit(id: string): boolean {
    if (visiting.has(id)) { return false }
    if (visited.has(id)) { return true }
    visiting.add(id)
    for (const dep of edges.get(id) ?? []) { if (!visit(dep)) { return false } }
    visiting.delete(id)
    visited.add(id)
    return true
  }
  return [...ids].every(visit)
}

export function isHubIntelligence(x: unknown): x is HubIntelligence {
  if (!record(x)) { return false }
  for (const [key, max] of Object.entries(MAX)) {
    const rows = x[key]
    if (!Array.isArray(rows) || rows.length > max) { return false }
  }
  const plans = x.plans as unknown[]
  const blockers = x.blockers as unknown[]
  const memories = x.memories as unknown[]
  const reviews = x.reviews as unknown[]
  const decisions = x.decisions as unknown[]
  const planIds = new Set<string>()
  const plansById = new Map<string, HubPlanProposal>()
  const blockerIds = new Set<string>()
  const memoryIds = new Set<string>()
  const allIds = new Set<string>()
  const takeId = (row: { id: unknown }): boolean => {
    if (!identifier(row.id) || allIds.has(row.id)) { return false }
    allIds.add(row.id)
    return true
  }
  for (const value of plans) {
    if (!isHubPlanProposal(value) || !takeId(value)) { return false }
    planIds.add(value.id)
    plansById.set(value.id, value)
    // Previous plans precede their revisions; blocker references are checked below.
    if (value.previousPlanId && (!planIds.has(value.previousPlanId) ||
      !value.blockerId)) { return false }
  }
  for (const value of blockers) {
    if (!record(value) || !takeId(value) || !identifier(value.planId) ||
      !identifier(value.taskId) || !content(value.observation, 2000) ||
      !content(value.recommendedAction, 1600) || !timestamp(value.createdAt)) { return false }
    const plan = plansById.get(value.planId)
    if (!plan?.tasks.some(t => t.id === value.taskId)) { return false }
    blockerIds.add(value.id)
  }
  // A replan may only cite a blocker belonging to the replaced plan.
  for (const p of plansById.values()) {
    if (p.previousPlanId && (!p.blockerId ||
      !blockers.some(b => record(b) && b.id === p.blockerId &&
        b.planId === p.previousPlanId))) { return false }
    if (!p.previousPlanId && p.blockerId) { return false }
  }
  for (const value of memories) {
    if (!record(value) || !takeId(value) || !content(value.lesson, 1500) ||
      !content(value.applicability, 800) || !content(value.evidenceRef, 600) ||
      !timestamp(value.createdAt)) { return false }
    memoryIds.add(value.id as string)
  }
  for (const value of reviews) {
    if (!record(value) || !takeId(value) || !identifier(value.planId) ||
      !identifier(value.taskId) || !['qa','human'].includes(String(value.reviewer)) ||
      !['approved','changes-requested','inconclusive'].includes(String(value.verdict)) ||
      !content(value.findings, 2000) || !content(value.evidenceRef, 600) ||
      !timestamp(value.createdAt)) { return false }
    if (!plansById.get(value.planId)?.tasks.some(t => t.id === value.taskId)) { return false }
  }
  const decided = new Set<string>()
  for (const value of decisions) {
    if (!record(value) || !takeId(value) ||
      !['plan','memory'].includes(String(value.subject)) ||
      !identifier(value.subjectId) || !['accepted','rejected'].includes(String(value.verdict)) ||
      !content(value.justification, 1000) || !timestamp(value.createdAt)) { return false }
    if (value.subject === 'plan' ? !planIds.has(value.subjectId as string) :
      !memoryIds.has(value.subjectId as string)) { return false }
    const key = `${value.subject}:${value.subjectId}`
    if (decided.has(key)) { return false }
    decided.add(key)
  }
  return true
}

/** Prior evidence is immutable; later entries append, never rewrite or disappear. */
export function isHubIntelligenceTransition(
  before: HubIntelligence | undefined,
  after: HubIntelligence | undefined
): boolean {
  const a = before ?? emptyHubIntelligence()
  const b = after ?? emptyHubIntelligence()
  return (Object.keys(MAX) as (keyof HubIntelligence)[]).every(key =>
    b[key].length >= a[key].length &&
    a[key].every((row, i) => JSON.stringify(row) === JSON.stringify(b[key][i]))
  )
}

/** Explicitly approved memories only. No automatic cross-project data sharing. */
export function approvedHubMemories(state: HubIntelligence): HubMemoryCandidate[] {
  const accepted = new Set(state.decisions.filter(d =>
    d.subject === 'memory' && d.verdict === 'accepted').map(d => d.subjectId))
  return state.memories.filter(m => accepted.has(m.id))
}
