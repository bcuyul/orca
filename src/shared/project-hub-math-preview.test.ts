import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import { simulateProjectHubMath, type ProjectHubMathScenario } from './project-hub-math-preview'

const scenario = (): ProjectHubMathScenario => {
  const document = emptyProjectHub('repo:lab')
  document.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-lab', objective: 'Review the Orca laboratory experiment',
      rationale: 'Explicitly user-reviewed DAG',
      source: 'human', createdAt: '2026-11-04T10:00:00Z',
      tasks: [
        { id: 'forge-lab-01', title: 'Make README changes', role: 'forge',
          dependsOn: [], acceptance: 'README must describe the lab' },
        { id: 'qa-lab-01', title: 'Review README changes', role: 'qa',
          dependsOn: ['forge-lab-01'], acceptance: 'Inspect actual diff' },
        { id: 'data-lab-01', title: 'Measure test outcomes', role: 'data',
          dependsOn: [], acceptance: 'Record benchmark results' }
      ]
    }],
    decisions: [{
      id: 'decision-lab', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'accepted', justification: 'Human approved the plan',
      createdAt: '2026-11-04T10:01:00Z'
    }]
  }
  return {
    document, swing: { user: 100, unlock: 60, urgency: 40 }, budget: 3,
    estimates: [
      { id: 'forge-lab-01', estimatedEffort: 2,
        criteria: { user: 40, unlock: 40, urgency: 40 } },
      { id: 'qa-lab-01', estimatedEffort: 1,
        criteria: { user: 100, unlock: 100, urgency: 100 } },
      { id: 'data-lab-01', estimatedEffort: 1,
        criteria: { user: 70, unlock: 70, urgency: 70 } }
    ]
  }
}

describe('Project Hub mathematical decision preview (never dispatch)', () => {
  it('computes elicited MCDA swings 100:60:40 and two auditable baselines', () => {
    const input = scenario()
    const frozen = JSON.stringify(input)
    const result = simulateProjectHubMath(input)
    expect(result.weights.user).toBeCloseTo(0.5)
    expect(result.weights.unlock).toBeCloseTo(0.3)
    expect(result.weights.urgency).toBeCloseTo(0.2)
    expect(result.rankingByValuePerEffort.map(item => item.id)).toEqual([
      'qa-lab-01', 'data-lab-01', 'forge-lab-01'
    ])
    // QA's high score requires Forge, so the closure is budgeted as a unit.
    expect(result.valuePerEffort.selectedIds).toEqual([
      'forge-lab-01', 'qa-lab-01'
    ])
    expect(result.valuePerEffort.totalEffort).toBe(3)
    expect(result.valuePerEffort.totalValue).toBeCloseTo(140)
    expect(result.fifo.selectedIds).toEqual(['forge-lab-01', 'qa-lab-01'])
    expect(result.unverified).toBe(true)
    expect(result.executionAuthorized).toBe(false)
    expect(JSON.stringify(input)).toBe(frozen)
  })

  it('rejects over-budget dependent closure, but may select a cheaper independent item', () => {
    const input = scenario()
    input.budget = 1
    const result = simulateProjectHubMath(input)
    expect(result.valuePerEffort.selectedIds).toEqual(['data-lab-01'])
    expect(result.valuePerEffort.totalEffort).toBe(1)
    expect(result.valuePerEffort.selectedIds).not.toContain('qa-lab-01')
  })

  it('supports zero budget without admitting any task and handles exact boundaries', () => {
    const input = scenario()
    input.budget = 0
    expect(simulateProjectHubMath(input).valuePerEffort.selectedIds).toEqual([])
    input.budget = 4
    expect(simulateProjectHubMath(input).valuePerEffort.selectedIds).toHaveLength(3)
  })

  it('fails closed on unapproved, rejected and malformed plans', () => {
    const input = scenario()
    input.document.intelligence!.decisions = []
    expect(() => simulateProjectHubMath(input)).toThrow(/aprobado/)
    input.document.intelligence!.decisions = [{
      id: 'reject-lab', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'rejected', justification: 'Rejected this plan',
      createdAt: '2026-11-04T10:01:00Z'
    }]
    expect(() => simulateProjectHubMath(input)).toThrow(/aprobado/)
  })

  it('rejects missing/duplicate/foreign estimates, NaN and unsupported budgets', () => {
    const input = scenario()
    input.estimates[0]!.id = 'other-project'
    expect(() => simulateProjectHubMath(input)).toThrow(/duplicadas/)
    input.estimates = [input.estimates[1]!, input.estimates[1]!, input.estimates[2]!]
    expect(() => simulateProjectHubMath(input)).toThrow(/duplicadas/)
    input.estimates = scenario().estimates
    input.budget = Number.NaN
    expect(() => simulateProjectHubMath(input)).toThrow(/Presupuesto/)
    input.budget = 1_000_001
    expect(() => simulateProjectHubMath(input)).toThrow(/Presupuesto/)
    input.budget = 3
    input.estimates[0]!.estimatedEffort = Infinity
    expect(() => simulateProjectHubMath(input)).toThrow(/Estimaciones/)
    input.estimates[0]!.estimatedEffort = 2
    input.estimates[0]!.criteria.user = -1
    expect(() => simulateProjectHubMath(input)).toThrow(/priority criteria/)
  })

  it('never silently chooses an invented swing weight or success probability', () => {
    const input = scenario()
    input.swing = { user: 0, unlock: 0, urgency: 0 }
    expect(() => simulateProjectHubMath(input)).toThrow(/swing/)
    input.swing = { user: 100, unlock: 60, urgency: 40 }
    expect(Object.keys(simulateProjectHubMath(input))).not.toContain('successProbability')
  })

  it('does not claim an optimal allocation when value/effort greedy loses to FIFO', () => {
    const input = scenario()
    // Synthetic counterexample: take a tiny high-ratio item first, preventing
    // the higher-value whole-budget task; this is a ranking heuristic, not ILP.
    input.document.intelligence!.plans[0]!.tasks[1]!.dependsOn = []
    input.estimates = [
      { id: 'forge-lab-01', estimatedEffort: 2,
        criteria: { user: 100, unlock: 100, urgency: 100 } },
      { id: 'qa-lab-01', estimatedEffort: 1,
        criteria: { user: 60, unlock: 60, urgency: 60 } },
      { id: 'data-lab-01', estimatedEffort: 1,
        criteria: { user: 0, unlock: 0, urgency: 0 } }
    ]
    input.budget = 2
    const result = simulateProjectHubMath(input)
    expect(result.valuePerEffort.selectedIds).toEqual(['qa-lab-01', 'data-lab-01'])
    expect(result.valuePerEffort.totalValue).toBeCloseTo(60)
    expect(result.fifo.selectedIds).toEqual(['forge-lab-01'])
    expect(result.fifo.totalValue).toBeCloseTo(100)
    expect(result.executionAuthorized).toBe(false)
  })

  it('rejects a cyclic DAG before producing scores or admitting work', () => {
    const input = scenario()
    input.document.intelligence!.plans[0]!.tasks[0]!.dependsOn = ['qa-lab-01']
    expect(() => simulateProjectHubMath(input)).toThrow(/válido/)
  })

  it('never confuses a budget-feasible set with authenticated execution eligibility', () => {
    const result = simulateProjectHubMath(scenario())
    expect(result.executionAuthorized).toBe(false)
    expect(result.valuePerEffort.status).toBe('heuristic-only')
    expect(result.valuePerEffort.selectedIds).not.toEqual([])
  })
})
