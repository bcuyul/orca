import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture.mjs'
import { validateProblem, taskUtility, exactSelection, greedySelection, listSchedule, binaryEvsi } from './decision-core.mjs'

const withTasks = tasks => ({ ...fixture, tasks })

test('fixture is a valid bounded DAG', () => assert.equal(validateProblem(fixture).size, 6))
test('swing-weight utilities stay finite and nonnegative', () => {
  for (const t of fixture.tasks) assert.ok(Number.isFinite(taskUtility(t, fixture.weights)) && taskUtility(t, fixture.weights) >= 0)
})
test('exact optimizer never violates mandatory tasks, closure or budget', () => {
  const plan = exactSelection(fixture)
  assert.equal(plan.status, 'optimal-subset')
  assert.ok(plan.selected.includes('A') && plan.selected.includes('B'))
  assert.ok(plan.effort <= fixture.budget)
  for (const id of plan.selected) {
    for (const dep of fixture.tasks.find(t => t.id === id).dependsOn) assert.ok(plan.selected.includes(dep))
  }
})
test('exact optimizer matches the reference optimum for this synthetic fixture', () => {
  assert.deepEqual(exactSelection(fixture).selected, ['A', 'B', 'C', 'D'])
})
test('invalid weights and scores fail closed', () => {
  assert.throws(() => validateProblem({ ...fixture, weights: { user: 1, unlock: 1, urgency: 1 } }), /sum to 1/)
  assert.throws(() => validateProblem(withTasks([{ ...fixture.tasks[0], user: 11 }])), /scores/)
})
test('cycles, unknown dependencies and duplicates fail closed', () => {
  assert.throws(() => validateProblem(withTasks(fixture.tasks.map(t => t.id === 'A' ? { ...t, dependsOn: ['B'] } : t))), /cycle/)
  assert.throws(() => validateProblem(withTasks(fixture.tasks.map(t => t.id === 'B' ? { ...t, dependsOn: ['missing'] } : t))), /missing/)
  assert.throws(() => validateProblem(withTasks([...fixture.tasks, fixture.tasks[0]])), /duplicate/)
})
test('human-pending tasks are never selected, even when otherwise attractive', () => {
  const problem = withTasks(fixture.tasks.map(t => t.id === 'D' ? { ...t, approval: 'pending' } : t))
  assert.ok(!exactSelection(problem).selected.includes('D'))
  assert.ok(!greedySelection(problem, 'wsjf').selected.includes('D'))
})
test('forbidden mandatory work cannot be silently traded for utility', () => {
  const problem = withTasks(fixture.tasks.map(t => t.id === 'A' ? { ...t, permitted: false } : t))
  assert.equal(exactSelection(problem).status, 'infeasible')
  assert.equal(greedySelection(problem).status, 'infeasible')
})
test('insufficient budget for mandatory tasks is infeasible, not success', () => {
  const problem = { ...fixture, budget: 6 }
  assert.equal(exactSelection(problem).status, 'infeasible')
  assert.equal(greedySelection(problem).status, 'infeasible')
})
test('higher budget does not reduce optimal achievable utility', () => {
  assert.ok(exactSelection({ ...fixture, budget: 16 }).utility >= exactSelection(fixture).utility)
})
test('selection deterministic across repeated calls', () => {
  assert.deepEqual(exactSelection(fixture), exactSelection(fixture))
})
test('feasible timeline respects dependencies and resource availability', () => {
  const choice = exactSelection(fixture)
  const { schedule, makespan } = listSchedule(fixture, choice.selected, [
    { id: 'forge', roles: ['forge', 'flow'] }, { id: 'data', roles: ['data'] }
  ])
  const byId = new Map(schedule.map(s => [s.id, s]))
  for (const item of schedule) {
    for (const dep of fixture.tasks.find(t => t.id === item.id).dependsOn)
      assert.ok(item.start >= byId.get(dep).end)
    assert.ok(item.end <= makespan)
  }
  for (const a of schedule) for (const b of schedule) if (a.id !== b.id && a.workerId === b.workerId)
    assert.ok(a.end <= b.start || b.end <= a.start)
})
test('list scheduling does not assign incompatible workers', () => {
  assert.throws(() => listSchedule(fixture, exactSelection(fixture).selected,
    [{ id: 'only-forge', roles: ['forge'] }]), /no compatible worker/)
})
test('binary EVSI reproduces the published decision-theory formulation with toy payoffs', () => {
  const r = binaryEvsi({ priorHigh: 0.5, accuracy: 0.8,
    payoff: { A: [100, 20], B: [60, 50] }, informationCost: 3 })
  assert.equal(r.baselineValue, 60)
  assert.equal(r.withInformationValue, 68)
  assert.equal(r.evsi, 8)
  assert.equal(r.netValue, 5)
  assert.equal(r.recommendResearch, true)
})
test('research is not recommended when it costs more than its expected value', () => {
  assert.equal(binaryEvsi({ priorHigh: 0.5, accuracy: 0.8,
    payoff: { A: [100, 20], B: [60, 50] }, informationCost: 9 }).recommendResearch, false)
})
test('exact lab covers the existing 20-node planning limit without spawning agents', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: 't' + i, effort: 1, pSuccess: 0.8, user: 0, unlock: 0, urgency: 0,
    dependsOn: [], mandatory: i === 0, permitted: true
  }))
  const r = exactSelection({ tasks, budget: 2, weights: fixture.weights })
  assert.equal(r.status, 'optimal-subset')
  assert.deepEqual(r.selected, ['t0'])
})
