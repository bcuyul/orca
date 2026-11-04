/** Scenario-only MCDA + bounded DAG budget heuristic for Project Hub.
 * Scores are not admission, probability, Cost of Delay, authorization or execution. */
import type { HubDocument } from './project-hub-types'
import type { PriorityCandidate, PriorityCriteria, PriorityWeights, RankedCandidate } from './adaptive-delivery/decision-contracts'
import { scoreCandidate, weightsFromSwing } from './adaptive-delivery/priority-score'
import { isHubPlanProposal, type HubPlanProposal } from './project-hub-intelligence'
import { previewNativeAgentRouting } from './project-hub-native-agent-routing'

export type ProjectHubEstimate = {
  id: string
  criteria: PriorityCriteria
  estimatedEffort: number
}
export type ProjectHubMathScenario = {
  document: HubDocument
  swing: PriorityCriteria
  budget: number
  estimates: ProjectHubEstimate[]
}
export type ProjectHubBudgetResult = {
  selectedIds: string[]
  totalEffort: number
  totalValue: number
  /** Constraint-respecting *hypothetical* plan, never a host dispatch. */
  status: 'heuristic-only'
}
/** Exhaustive benchmark is deliberately bounded: at most 4096 subsets. */
export const PROJECT_HUB_EXACT_TASK_LIMIT = 12

export type ProjectHubExactResult = {
  selectedIds: string[]
  totalEffort: number
  totalValue: number
  status: 'exact-for-additive-model'
  evaluatedSubsets: number
  feasibleSubsets: number
}
export type ProjectHubOptimalityGap = {
  absolute: number
  percent: number
}
export type ProjectHubMathResult = {
  planId: string
  weights: PriorityWeights
  rankingByValue: RankedCandidate[]
  rankingByValuePerEffort: RankedCandidate[]
  fifo: ProjectHubBudgetResult
  valuePerEffort: ProjectHubBudgetResult
  exact: ProjectHubExactResult | null
  fifoGap: ProjectHubOptimalityGap | null
  valuePerEffortGap: ProjectHubOptimalityGap | null
  exactTaskLimit: typeof PROJECT_HUB_EXACT_TASK_LIMIT
  unverified: true
  executionAuthorized: false
}

function acceptedPlan(doc: HubDocument): HubPlanProposal {
  const id = previewNativeAgentRouting(doc, 'pending', null).approvedPlanId
  const plan = doc.intelligence?.plans.find(p => p.id === id)
  if (!id || !plan || !isHubPlanProposal(plan)) {
    throw new Error('Se requiere un DAG de Atlas aprobado y válido')
  }
  return plan
}

/** Simulates subset selection with transitive dependency closure, O(n²) for n <= 20. */
function greedyBudget(
  plan: HubPlanProposal,
  orderedIds: readonly string[],
  scores: ReadonlyMap<string, RankedCandidate>,
  effort: ReadonlyMap<string, number>,
  budget: number
): ProjectHubBudgetResult {
  const byId = new Map(plan.tasks.map(task => [task.id, task]))
  const selected = new Set<string>()
  let totalEffort = 0
  for (const id of orderedIds) {
    const closure = new Set<string>()
    function addWithDependencies(candidateId: string): void {
      if (selected.has(candidateId) || closure.has(candidateId)) { return }
      const task = byId.get(candidateId)
      if (!task) { throw new Error('Dependencia no encontrada') }
      for (const dep of task.dependsOn) { addWithDependencies(dep) }
      closure.add(candidateId)
    }
    addWithDependencies(id)
    const incrementalEffort = [...closure].reduce(
      (sum, candidateId) => sum + (effort.get(candidateId) ?? 0), 0
    )
    if (totalEffort + incrementalEffort <= budget) {
      for (const candidateId of closure) { selected.add(candidateId) }
      totalEffort += incrementalEffort
    }
  }
  const totalValue = [...selected].reduce(
    (sum, id) => sum + (scores.get(id)?.value ?? 0), 0
  )
  return {
    selectedIds: [...selected],
    totalEffort,
    totalValue,
    status: 'heuristic-only'
  }
}

/**
 * Exact knapsack-with-precedence benchmark for the stated additive MCDA model.
 * Exhaustive 2^n subsets, O(2^n * n), n <= 12. Not resource scheduling,
 * probability, agent admission or a guarantee about real-world outcomes.
 */
function exactBudget(
  plan: HubPlanProposal,
  scores: ReadonlyMap<string, RankedCandidate>,
  effort: ReadonlyMap<string, number>,
  budget: number
): ProjectHubExactResult | null {
  const tasks = plan.tasks
  if (tasks.length > PROJECT_HUB_EXACT_TASK_LIMIT) { return null }
  const position = new Map(tasks.map((task, index) => [task.id, index]))
  const deps = tasks.map(task => task.dependsOn.reduce((mask, dep) => {
    const index = position.get(dep)
    if (index === undefined) { throw new Error('Dependencia no encontrada') }
    return mask | (1 << index)
  }, 0))
  const subsetCount = 1 << tasks.length
  let bestMask = 0, bestValue = 0, bestEffort = 0, feasibleSubsets = 0
  for (let mask = 0; mask < subsetCount; mask++) {
    let totalValue = 0, totalEffort = 0, feasible = true
    for (let i = 0; i < tasks.length; i++) {
      if ((mask & (1 << i)) === 0) { continue }
      if ((mask & deps[i]!) !== deps[i]) { feasible = false; break }
      const id = tasks[i]!.id
      totalEffort += effort.get(id) ?? 0
      // Strict cap: no epsilon allowance for numerical overspend.
      if (totalEffort > budget) { feasible = false; break }
      totalValue += scores.get(id)?.value ?? 0
    }
    if (!feasible) { continue }
    feasibleSubsets++
    // Deterministic: maximal value, then minimal effort, then first mask.
    if (totalValue > bestValue ||
        (totalValue === bestValue && totalEffort < bestEffort)) {
      bestMask = mask
      bestValue = totalValue
      bestEffort = totalEffort
    }
  }
  return {
    selectedIds: tasks.filter((_, index) => (bestMask & (1 << index)) !== 0)
      .map(task => task.id),
    totalEffort: bestEffort,
    totalValue: bestValue,
    status: 'exact-for-additive-model',
    evaluatedSubsets: subsetCount,
    feasibleSubsets
  }
}

function optimalityGap(
  exact: ProjectHubExactResult | null,
  candidate: ProjectHubBudgetResult
): ProjectHubOptimalityGap | null {
  if (!exact) { return null }
  const absolute = Math.max(0, exact.totalValue - candidate.totalValue)
  return { absolute, percent: exact.totalValue === 0 ? 0 :
    (100 * absolute) / exact.totalValue }
}

/**
 * The same numerical estimates are compared under FIFO and value/effort.
 * Swing judgments, effort and budgets are human scenario inputs, not telemetry.
 * No raw LLM output, permissions or user-entered "admission" are accepted.
 */
export function simulateProjectHubMath(input: ProjectHubMathScenario): ProjectHubMathResult {
  const { document, estimates, swing, budget } = input
  const plan = acceptedPlan(document)
  if (!Number.isFinite(budget) || budget < 0 || budget > 1_000_000) {
    throw new Error('Presupuesto inválido: debe estar entre 0 y 1000000')
  }
  if (!Array.isArray(estimates) || estimates.length !== plan.tasks.length ||
      estimates.length > 20) {
    throw new Error('Debe estimarse cada tarea del DAG exactamente una vez')
  }
  const weights = weightsFromSwing(swing)
  const estimated = new Map<string, ProjectHubEstimate>()
  const planIds = new Set(plan.tasks.map(task => task.id))
  for (const item of estimates) {
    if (!item || !planIds.has(item.id) || estimated.has(item.id) ||
        !Number.isFinite(item.estimatedEffort) || item.estimatedEffort <= 0 ||
        item.estimatedEffort > 1_000_000) {
      throw new Error('Estimaciones duplicadas, ausentes o inválidas')
    }
    estimated.set(item.id, item)
  }
  const effort = new Map<string, number>()
  const scores = new Map<string, RankedCandidate>()
  for (const task of plan.tasks) {
    const estimate = estimated.get(task.id)
    if (!estimate) { throw new Error('Falta una estimación para una tarea') }
    // Pending, critical and human-review-required are conservative stand-ins;
    // these advisory records can never be submitted as host grants.
    const candidate: PriorityCandidate = {
      id: task.id, title: task.title, role: task.role,
      dependsOn: [...task.dependsOn], state: 'todo', admission: 'pending',
      humanReview: 'pending', risk: 'critical',
      criteria: estimate.criteria, estimatedEffort: estimate.estimatedEffort
    }
    const score = scoreCandidate(candidate, weights)
    effort.set(task.id, estimate.estimatedEffort)
    scores.set(task.id, score)
  }
  const rankingByValue = [...scores.values()].sort(
    (a, b) => b.value - a.value || a.id.localeCompare(b.id, 'en')
  )
  const rankingByValuePerEffort = [...scores.values()].sort(
    (a, b) => b.valuePerEffort - a.valuePerEffort || a.id.localeCompare(b.id, 'en')
  )
  const fifo = greedyBudget(plan, plan.tasks.map(task => task.id), scores, effort, budget)
  const valuePerEffort = greedyBudget(plan,
    rankingByValuePerEffort.map(score => score.id), scores, effort, budget)
  const exact = exactBudget(plan, scores, effort, budget)
  return {
    planId: plan.id,
    weights,
    rankingByValue,
    rankingByValuePerEffort,
    fifo,
    valuePerEffort,
    exact,
    fifoGap: optimalityGap(exact, fifo),
    valuePerEffortGap: optimalityGap(exact, valuePerEffort),
    exactTaskLimit: PROJECT_HUB_EXACT_TASK_LIMIT,
    unverified: true,
    executionAuthorized: false
  }
}
