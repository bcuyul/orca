import {
  assertPriorityProblem, type BlockedCandidate, type PriorityProblem,
  type PriorityRanking, type RankedCandidate, type PriorityWeights
} from './decision-contracts'
import { scoreCandidate } from './priority-score'

export type PriorityStrategy = 'value' | 'value_per_effort' | 'fifo'

/**
 * Classifies *ready* tasks only. All results are advisory and MUST be passed
 * through host-owned Scope/Budget/Run admission before any real dispatch.
 */
export function rankReadyTasks(problem: PriorityProblem, strategy: PriorityStrategy = 'value'): PriorityRanking {
  assertPriorityProblem(problem)
  if (!['value', 'value_per_effort', 'fifo'].includes(strategy)) throw new Error('unsupported strategy')
  const completed = new Set(problem.candidates.filter(c => c.state === 'completed').map(c => c.id))
  const eligible: RankedCandidate[] = []
  const excluded: BlockedCandidate[] = []
  for (const candidate of problem.candidates) {
    if (candidate.state === 'completed') continue
    const reasons: BlockedCandidate['reasons'] = []
    if (candidate.admission === 'denied') reasons.push('denied')
    else if (candidate.admission !== 'granted') reasons.push('unapproved')
    if (candidate.humanReview === 'pending' ||
        ((candidate.risk === 'high' || candidate.risk === 'critical') && candidate.humanReview !== 'approved')) {
      reasons.push('needs_human_review')
    }
    if (candidate.state === 'blocked') reasons.push('blocked')
    if (candidate.state === 'in_progress') reasons.push('active')
    if (candidate.dependsOn.some(id => !completed.has(id))) reasons.push('dependencies')
    if (reasons.length) excluded.push({ id: candidate.id, reasons })
    else eligible.push(scoreCandidate(candidate, problem.weights))
  }
  // FIFO respects the input order (only permitted/ready tasks enter the queue).
  if (strategy !== 'fifo') {
    eligible.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) ||
      (strategy === 'value' ? b.value - a.value : b.valuePerEffort - a.valuePerEffort) ||
      a.id.localeCompare(b.id, 'en'))
  }
  return { eligible, excluded, completedIds: [...completed].sort(), executionAuthorized: false }
}

/** Compares proposed weight profiles, never invents weights from a model. */
export function compareProfiles(problem: PriorityProblem, profiles: Record<string, PriorityWeights>): {
  profile: string; ranking: string[]
}[] {
  assertPriorityProblem(problem)
  if (Object.keys(profiles).length < 1 || Object.keys(profiles).length > 12) throw new Error('1..12 profiles required')
  return Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([profile, weights]) => ({
    profile,
    ranking: rankReadyTasks({ candidates: problem.candidates, weights }).eligible.map(x => x.id)
  }))
}
