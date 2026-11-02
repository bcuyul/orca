import { describe, expect, it } from 'vitest'
import { analyzeIntent } from './intent-analyzer'
import {
  assertPriorityCriteria, assertPriorityProblem, assertPriorityWeights,
  type PriorityCandidate, type PriorityProblem
} from './decision-contracts'
import { comparePriorityWeights, scoreCandidate, weightsFromSwing } from './priority-score'
import { compareProfiles, rankReadyTasks } from './priority-policy'

const weights = { user: 0.5, unlock: 0.3, urgency: 0.2 }
const sample = (id: string, changes: Partial<PriorityCandidate> = {}): PriorityCandidate => ({
  id, title: `Deliver ${id}`, role: 'forge', dependsOn: [], state: 'todo',
  admission: 'granted', humanReview: 'not_required', risk: 'low',
  estimatedEffort: 2, criteria: { user: 80, unlock: 20, urgency: 40 }, ...changes
})
const problem = (candidates: PriorityCandidate[]): PriorityProblem => ({ candidates, weights })

describe('intent classification is advisory and risk-aware', () => {
  it('classifies a simple UI correction with no mandatory gate', () => {
    expect(analyzeIntent({ objective: 'Corrige el texto del botón de guardar' })).toMatchObject({
      kind: 'microfix', risk: 'low', planning: 'direct', executionAuthorized: false
    })
  })
  it('does not treat small security changes as safe', () => {
    expect(analyzeIntent({ objective: 'Fix login permissions, just one line, very simple' })).toMatchObject({
      kind: 'microfix', risk: 'high', humanGate: 'mandatory', executionAuthorized: false
    })
  })
  it('recognizes password reset as a security-sensitive use case', () => {
    expect(analyzeIntent({ objective: 'Implementa recuperar contraseña de usuarios' })).toMatchObject({
      kind: 'use_case', risk: 'high', humanGate: 'mandatory'
    })
  })
  it('recognizes a module with bounded planning', () => {
    expect(analyzeIntent({ objective: 'Implementa el módulo de inventario' })).toMatchObject({
      kind: 'module', planning: 'bounded_dag'
    })
  })
  it('recognizes a complete project with planning and user review', () => {
    expect(analyzeIntent({ objective: 'Crea una aplicación completa desde cero para reservas' })).toMatchObject({
      kind: 'project', planning: 'full_plan', humanGate: 'recommended'
    })
  })
  it('recognizes a request to research before implementation', () => {
    expect(analyzeIntent({ objective: 'Investiga la viabilidad de una arquitectura' })).toMatchObject({
      kind: 'research', planning: 'research_first'
    })
  })
  it('fails conservatively on unrecognized objectives instead of authorizing execution', () => {
    expect(analyzeIntent({ objective: 'Quiero algo moderno y rápido' })).toMatchObject({
      kind: 'use_case', ambiguity: 'high', humanGate: 'recommended', executionAuthorized: false
    })
  })
  it('rejects empty and oversized requests', () => {
    expect(() => analyzeIntent({ objective: '   ' })).toThrow()
    expect(() => analyzeIntent({ objective: 'a'.repeat(4001) })).toThrow()
  })
  it('never downgrades production/deployment risks due to simple language', () => {
    expect(analyzeIntent({ objective: 'Fix production deploy, trivial change' })).toMatchObject({
      risk: 'critical', humanGate: 'mandatory'
    })
  })
})

describe('swing weights and multicriteria valuation', () => {
  it('normalizes elicited 100:60:40 swings to 0.5:0.3:0.2', () => {
    const result = weightsFromSwing({ user: 100, unlock: 60, urgency: 40 })
    expect(result.user).toBeCloseTo(0.5)
    expect(result.unlock).toBeCloseTo(0.3)
    expect(result.urgency).toBeCloseTo(0.2)
  })
  it('rejects unnormalized, NaN, negative and infinite weights', () => {
    for (const w of [
      { user: 1, unlock: 1, urgency: 1 },
      { user: Number.NaN, unlock: 0, urgency: 1 },
      { user: -0.1, unlock: 0.2, urgency: 0.9 },
      { user: 1, unlock: 0, urgency: Infinity }
    ]) expect(() => assertPriorityWeights(w)).toThrow()
  })
  it('rejects zero swings, invalid scores and non-finite effort', () => {
    expect(() => weightsFromSwing({ user: 0, unlock: 0, urgency: 0 })).toThrow()
    expect(() => assertPriorityCriteria({ user: 101, unlock: 0, urgency: 0 })).toThrow()
    expect(() => scoreCandidate(sample('A', { estimatedEffort: Infinity }), weights)).toThrow()
  })
  it('calculates auditable score components and effort ratio', () => {
    const result = scoreCandidate(sample('A'), weights)
    expect(result.components).toEqual({ user: 40, unlock: 6, urgency: 8 })
    expect(result.value).toBe(54)
    expect(result.valuePerEffort).toBe(27)
  })
  it('compares weight profiles without changing the original objects', () => {
    expect(comparePriorityWeights(weights, { user: 0.4, unlock: 0.4, urgency: 0.2 })).toBeCloseTo(0.2)
  })
})

describe('priority eligibility, dependency closure and deterministic ordering', () => {
  it('rejects cycles, unknown dependencies and duplicate IDs', () => {
    expect(() => assertPriorityProblem(problem([sample('A', { dependsOn: ['B'] }), sample('B', { dependsOn: ['A'] })]))).toThrow(/cycle/)
    expect(() => assertPriorityProblem(problem([sample('A', { dependsOn: ['Z'] })]))).toThrow(/unknown/)
    expect(() => assertPriorityProblem(problem([sample('A'), sample('A')]))).toThrow(/duplicated/)
  })
  it('rejects malformed tasks, missing permissions and oversized DAG', () => {
    expect(() => assertPriorityProblem(problem([sample('A', { admission: undefined as never })]))).toThrow()
    expect(() => assertPriorityProblem(problem([sample('A', { estimatedEffort: 0 })]))).toThrow()
    expect(() => assertPriorityProblem(problem(Array.from({ length: 21 }, (_, i) => sample(`A${i}`))))).toThrow()
  })
  it('never selects a high-priority pending or denied task', () => {
    const result = rankReadyTasks(problem([
      sample('DENIED', { admission: 'denied', criteria: { user: 100, unlock: 100, urgency: 100 } }),
      sample('PENDING', { admission: 'pending' }), sample('OK')
    ]))
    expect(result.eligible.map(t => t.id)).toEqual(['OK'])
    expect(result.excluded).toEqual([
      { id: 'DENIED', reasons: ['denied'] }, { id: 'PENDING', reasons: ['unapproved'] }
    ])
    expect(result.executionAuthorized).toBe(false)
  })
  it('does not bypass a required human review even with granted task admission', () => {
    const result = rankReadyTasks(problem([
      sample('HIGH', { risk: 'high' }),
      sample('CRITICAL', { risk: 'critical', humanReview: 'pending' }),
      sample('APPROVED', { risk: 'high', humanReview: 'approved' })
    ]))
    expect(result.eligible.map(x => x.id)).toEqual(['APPROVED'])
    expect(result.excluded[0].reasons).toContain('needs_human_review')
  })
  it('does not select a dependent task unless its prerequisite is completed', () => {
    const result = rankReadyTasks(problem([
      sample('A'), sample('B', { dependsOn: ['A'], criteria: { user: 100, unlock: 100, urgency: 100 } })
    ]))
    expect(result.eligible.map(t => t.id)).toEqual(['A'])
    expect(result.excluded).toEqual([{ id: 'B', reasons: ['dependencies'] }])
  })
  it('accepts completed prerequisites but never re-queues completed tasks', () => {
    const result = rankReadyTasks(problem([sample('A', { state: 'completed' }), sample('B', { dependsOn: ['A'] })]))
    expect(result.completedIds).toEqual(['A'])
    expect(result.eligible.map(t => t.id)).toEqual(['B'])
  })
  it('distinguishes already running and blocked work', () => {
    const result = rankReadyTasks(problem([
      sample('A', { state: 'in_progress' }), sample('B', { state: 'blocked' })
    ]))
    expect(result.eligible).toHaveLength(0)
    expect(result.excluded).toEqual([
      { id: 'A', reasons: ['active'] }, { id: 'B', reasons: ['blocked'] }
    ])
  })
  it('orders eligible tasks by value with deterministic ID tie breaks', () => {
    const result = rankReadyTasks(problem([
      sample('Z'), sample('B', { criteria: { user: 100, unlock: 100, urgency: 100 } }), sample('A')
    ]))
    expect(result.eligible.map(t => t.id)).toEqual(['B', 'A', 'Z'])
  })
  it('has a distinct effort-normalized heuristic without claiming economic cost-of-delay', () => {
    const list = [sample('A', { estimatedEffort: 8, criteria: { user: 100, unlock: 100, urgency: 100 } }),
      sample('B', { estimatedEffort: 1 })]
    expect(rankReadyTasks(problem(list), 'value').eligible.map(x => x.id)).toEqual(['A', 'B'])
    expect(rankReadyTasks(problem(list), 'value_per_effort').eligible.map(x => x.id)).toEqual(['B', 'A'])
    expect(rankReadyTasks(problem(list), 'fifo').eligible.map(x => x.id)).toEqual(['A', 'B'])
  })
  it('preserves input order as FIFO even with different values', () => {
    const result = rankReadyTasks(problem([sample('Z'), sample('A', { criteria: { user: 100, unlock: 100, urgency: 100 } })]), 'fifo')
    expect(result.eligible.map(x => x.id)).toEqual(['Z', 'A'])
  })
  it('keeps mandatory tasks ahead of optional work without violating readiness', () => {
    expect(rankReadyTasks(problem([
      sample('OPTIONAL', { criteria: { user: 100, unlock: 100, urgency: 100 } }),
      sample('MUST', { mandatory: true })
    ])).eligible.map(x => x.id)).toEqual(['MUST', 'OPTIONAL'])
  })
  it('supports human-chosen comparison profiles, still advisory only', () => {
    const p = problem([
      sample('A', { criteria: { user: 90, unlock: 1, urgency: 1 } }),
      sample('B', { criteria: { user: 1, unlock: 90, urgency: 1 } })
    ])
    expect(compareProfiles(p, { user: { user: 1, unlock: 0, urgency: 0 }, unlock: { user: 0, unlock: 1, urgency: 0 } })).toEqual([
      { profile: 'unlock', ranking: ['B', 'A'] }, { profile: 'user', ranking: ['A', 'B'] }
    ])
  })
  it('does not mutate task input when calculating rankings', () => {
    const input = problem([sample('B'), sample('A')]); const snapshot = JSON.stringify(input)
    rankReadyTasks(input, 'value_per_effort')
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
