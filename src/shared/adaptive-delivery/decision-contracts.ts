/**
 * Advisory-only Adaptive Delivery contracts. A model or renderer must NEVER use
 * these records as permission to create Runs, Dispatches or agent sessions.
 * Host authorization and budget admission are deliberately out of scope.
 */
import type { HubPlanTask } from '../project-hub-intelligence'

export const WORK_KINDS = ['microfix', 'use_case', 'module', 'project', 'research'] as const
export type WorkKind = (typeof WORK_KINDS)[number]
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]
export type PlanningStrategy = 'direct' | 'bounded_dag' | 'full_plan' | 'research_first'
export type HumanGate = 'not_required' | 'recommended' | 'mandatory'

export type IntentAssessment = {
  kind: WorkKind
  risk: RiskLevel
  ambiguity: 'low' | 'medium' | 'high'
  planning: PlanningStrategy
  humanGate: HumanGate
  reasons: string[]
  /** Classification cannot grant execution authority. */
  executionAuthorized: false
}

export type PriorityCriteria = { user: number; unlock: number; urgency: number }
export type PriorityWeights = PriorityCriteria
export type SwingJudgments = PriorityCriteria

export type CandidateState = 'todo' | 'in_progress' | 'completed' | 'blocked'
export type AdvisoryAdmission = 'granted' | 'pending' | 'denied'
export type ReviewEvidence = 'approved' | 'pending' | 'not_required'
export type PriorityCandidate = {
  id: string
  title: string
  role: HubPlanTask['role']
  dependsOn: string[]
  state: CandidateState
  /** Host-sourced snapshot, not a permission token. Do not trust model data. */
  admission: AdvisoryAdmission
  /** Explicit human checkpoint record where one is required. */
  humanReview: ReviewEvidence
  risk: RiskLevel
  criteria: PriorityCriteria
  estimatedEffort: number
  mandatory?: boolean
}

export type PriorityProblem = {
  candidates: PriorityCandidate[]
  weights: PriorityWeights
}

export type RankedCandidate = {
  id: string
  value: number
  valuePerEffort: number
  mandatory: boolean
  /** Explanation is a score breakdown, not a policy grant. */
  components: PriorityCriteria
}
export type BlockedCandidate = {
  id: string
  reasons: ('unapproved' | 'denied' | 'needs_human_review' | 'blocked' | 'active' | 'dependencies')[]
}
export type PriorityRanking = {
  eligible: RankedCandidate[]
  excluded: BlockedCandidate[]
  completedIds: string[]
  executionAuthorized: false
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
const roles: ReadonlySet<string> = new Set(['atlas', 'forge', 'flow', 'data', 'qa'])
const states: ReadonlySet<string> = new Set(['todo', 'in_progress', 'completed', 'blocked'])
const risks: ReadonlySet<string> = new Set(RISK_LEVELS)
const admissions: ReadonlySet<string> = new Set(['granted', 'pending', 'denied'])
const reviews: ReadonlySet<string> = new Set(['approved', 'pending', 'not_required'])
const fields = ['user', 'unlock', 'urgency'] as const
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function assertPriorityCriteria(value: unknown): asserts value is PriorityCriteria {
  if (!isRecord(value) || fields.some(key => !finite(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 100)) {
    throw new Error('priority criteria must be finite scores in [0, 100]')
  }
}

export function assertPriorityWeights(value: unknown): asserts value is PriorityWeights {
  if (!isRecord(value) || fields.some(key => !finite(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 1) ||
      Math.abs((value.user as number) + (value.unlock as number) + (value.urgency as number) - 1) > 1e-9) {
    throw new Error('priority weights must be nonnegative, finite and sum to 1')
  }
}

/** Reject malformed DAG input before calculating any score. */
export function assertPriorityProblem(value: unknown): asserts value is PriorityProblem {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length < 1 ||
      value.candidates.length > 20) throw new Error('priority problem requires 1..20 candidates')
  assertPriorityWeights(value.weights)
  const ids = new Set<string>()
  const dependencies = new Map<string, string[]>()
  for (const raw of value.candidates) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !idPattern.test(raw.id) || ids.has(raw.id) ||
        typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 160 ||
        !roles.has(String(raw.role)) || !states.has(String(raw.state)) ||
        !risks.has(String(raw.risk)) || !admissions.has(String(raw.admission)) ||
        !reviews.has(String(raw.humanReview)) || !finite(raw.estimatedEffort) || raw.estimatedEffort <= 0 ||
        (raw.mandatory !== undefined && typeof raw.mandatory !== 'boolean') ||
        !Array.isArray(raw.dependsOn) || raw.dependsOn.length > 19 ||
        raw.dependsOn.some(d => typeof d !== 'string' || !idPattern.test(d)) ||
        new Set(raw.dependsOn).size !== raw.dependsOn.length) throw new Error('invalid or duplicated priority candidate')
    assertPriorityCriteria(raw.criteria)
    ids.add(raw.id)
    dependencies.set(raw.id, raw.dependsOn as string[])
  }
  for (const deps of dependencies.values()) {
    if (deps.some(id => !ids.has(id))) throw new Error('unknown priority dependency')
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error('priority DAG contains a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of dependencies.get(id) ?? []) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
}
