import {
  assertPriorityCriteria, assertPriorityWeights,
  type PriorityCriteria, type PriorityWeights, type RankedCandidate, type PriorityCandidate,
  type SwingJudgments
} from './decision-contracts'

const keys = ['user', 'unlock', 'urgency'] as const

/** Swing scores are relative values of BEST-vs-WORST improvements, not vague importance. */
export function weightsFromSwing(judgments: SwingJudgments): PriorityWeights {
  assertPriorityCriteria(judgments)
  const total = keys.reduce((sum, key) => sum + judgments[key], 0)
  if (total <= 0) { throw new Error('at least one swing must be positive') }
  // Keep exact normalization by deriving the last component from the first two.
  const user = judgments.user / total
  const unlock = judgments.unlock / total
  const urgency = 1 - user - unlock
  const weights = { user, unlock, urgency }
  assertPriorityWeights(weights)
  return weights
}

/** A transparent, additive MCDA score. No fabricated probability of success. */
export function scoreCandidate(candidate: PriorityCandidate, weights: PriorityWeights): RankedCandidate {
  assertPriorityWeights(weights)
  assertPriorityCriteria(candidate.criteria)
  if (!Number.isFinite(candidate.estimatedEffort) || candidate.estimatedEffort <= 0) {
    throw new Error('estimatedEffort must be finite and positive')
  }
  const components: PriorityCriteria = {
    user: candidate.criteria.user * weights.user,
    unlock: candidate.criteria.unlock * weights.unlock,
    urgency: candidate.criteria.urgency * weights.urgency
  }
  const value = components.user + components.unlock + components.urgency
  return {
    id: candidate.id,
    value,
    valuePerEffort: value / candidate.estimatedEffort,
    mandatory: candidate.mandatory === true,
    components
  }
}

export function comparePriorityWeights(a: PriorityWeights, b: PriorityWeights): number {
  assertPriorityWeights(a)
  assertPriorityWeights(b)
  return keys.reduce((sum, key) => sum + Math.abs(a[key] - b[key]), 0)
}
