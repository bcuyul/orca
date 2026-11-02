import { fixture } from './fixture.mjs'
import { binaryEvsi, exactSelection, greedySelection, listSchedule } from './decision-core.mjs'

const scenarios = [
  ['base', fixture],
  ['low-budget', { ...fixture, budget: 7 }],
  ['high-budget', { ...fixture, budget: 15 }],
  ['security-required', { ...fixture, tasks: fixture.tasks.map(t => t.id === 'F' ? { ...t, mandatory: true } : t) }],
  ['human-blocks-D', { ...fixture, tasks: fixture.tasks.map(t => t.id === 'D' ? { ...t, approval: 'pending' } : t) }],
  ['C-low-confidence', { ...fixture, tasks: fixture.tasks.map(t => t.id === 'C' ? { ...t, pSuccess: 0.15 } : t) }],
]
const results = scenarios.map(([scenario, problem]) => {
  const fifo = greedySelection(problem, 'fifo')
  const wsjf = greedySelection(problem, 'wsjf')
  const exact = exactSelection(problem)
  const timeline = exact.status === 'optimal-subset'
    ? listSchedule(problem, exact.selected, [
      { id: 'data-1', roles: ['data'] },
      { id: 'forge-1', roles: ['forge', 'flow'] }
    ]) : null
  return { scenario, budget: problem.budget, fifo, wsjf, exact, greedySchedule: timeline }
})
const evsi = binaryEvsi({
  priorHigh: 0.5, accuracy: 0.8,
  payoff: { A: [100, 20], B: [60, 50] }, informationCost: 3
})
const output = { kind: 'synthetic-feasibility-benchmark', status: 'offline-only',
  assumptions: 'Illustrative utility and effort scales; not Orca empirical predictions',
  results, valueOfInformation: evsi }
process.stdout.write(JSON.stringify(output, null, 2) + '\n')
