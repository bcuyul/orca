/**
 * Orca Adaptive Delivery — deterministic feasibility lab, NOT production scheduler.
 * No network, filesystem, model calls, side effects or mutable global state.
 * Compare small backlogs (up to 20 tasks) with exact subset enumeration.
 */

const nearly = (a, b) => Math.abs(a - b) < 1e-9
const assert = (condition, message) => { if (!condition) throw new Error(message) }

export function validateProblem(problem) {
  assert(problem && typeof problem === 'object', 'problem must be object')
  const { tasks, budget, weights } = problem
  assert(Array.isArray(tasks) && tasks.length > 0 && tasks.length <= 20, '1..20 tasks required')
  assert(Number.isFinite(budget) && budget >= 0, 'budget must be finite nonnegative')
  assert(weights && ['user', 'unlock', 'urgency'].every(k => Number.isFinite(weights[k]) && weights[k] >= 0), 'invalid weights')
  assert(nearly(weights.user + weights.unlock + weights.urgency, 1), 'weights must sum to 1')
  const ids = new Set()
  const byId = new Map()
  for (const task of tasks) {
    assert(task && typeof task === 'object' && typeof task.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(task.id), 'invalid task id')
    assert(!ids.has(task.id), 'duplicate task id')
    ids.add(task.id)
    assert(Number.isFinite(task.effort) && task.effort > 0, 'effort must be positive')
    assert(Number.isFinite(task.pSuccess) && task.pSuccess >= 0 && task.pSuccess <= 1, 'invalid success estimate')
    assert(['user', 'unlock', 'urgency'].every(k => Number.isFinite(task[k]) && task[k] >= 0 && task[k] <= 10), 'scores must be in 0..10')
    assert(Array.isArray(task.dependsOn) && new Set(task.dependsOn).size === task.dependsOn.length, 'invalid dependencies')
    assert(task.mandatory === undefined || typeof task.mandatory === 'boolean', 'invalid mandatory flag')
    assert(task.permitted === undefined || typeof task.permitted === 'boolean', 'invalid permitted flag')
    assert(task.approval === undefined || ['granted', 'pending', 'denied'].includes(task.approval), 'invalid approval flag')
    byId.set(task.id, task)
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) assert(ids.has(dependency), `missing dependency ${dependency}`)
  }
  const visiting = new Set(), visited = new Set()
  function visit(id) {
    assert(!visiting.has(id), 'dependency cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of byId.get(id).dependsOn) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  return byId
}

export function taskUtility(task, weights) {
  return task.pSuccess * (weights.user * task.user + weights.unlock * task.unlock + weights.urgency * task.urgency)
}

const permitted = task => task.permitted !== false && (task.approval === undefined || task.approval === 'granted')

function analyseSelection(selected, byId, budget) {
  const set = new Set(selected)
  if ([...byId.values()].some(t => t.mandatory && !set.has(t.id))) return null
  let effort = 0
  for (const id of set) {
    const task = byId.get(id)
    if (!permitted(task) || task.dependsOn.some(dep => !set.has(dep))) return null
    effort += task.effort
    if (effort > budget + 1e-9) return null
  }
  return { effort }
}

function resultOf(selected, problem, byId) {
  const evidence = analyseSelection(selected, byId, problem.budget)
  if (!evidence) return null
  const ids = [...selected].sort()
  return {
    selected: ids,
    effort: evidence.effort,
    utility: ids.reduce((sum, id) => sum + taskUtility(byId.get(id), problem.weights), 0)
  }
}

export function exactSelection(problem) {
  const byId = validateProblem(problem)
  const { tasks } = problem
  // Explicitly non-production: exhaustive search is acceptable only for tiny DAGs.
  const count = 2 ** tasks.length
  let best = null
  for (let mask = 0; mask < count; mask++) {
    const selected = []
    for (let i = 0; i < tasks.length; i++) if (mask & (2 ** i)) selected.push(tasks[i].id)
    const candidate = resultOf(selected, problem, byId)
    if (!candidate) continue
    const key = candidate.selected.join(',')
    const bestKey = best?.selected.join(',') ?? ''
    if (!best || candidate.utility > best.utility + 1e-9 ||
        (nearly(candidate.utility, best.utility) &&
          (candidate.effort < best.effort - 1e-9 ||
           (nearly(candidate.effort, best.effort) && key < bestKey)))) {
      best = candidate
    }
  }
  if (!best) return { status: 'infeasible', selected: [], utility: 0, effort: 0 }
  return { status: 'optimal-subset', ...best }
}

/** Baselines: FIFO and WSJF-like utility/effort, with dependency closure and hard guards. */
export function greedySelection(problem, strategy = 'fifo') {
  const byId = validateProblem(problem)
  assert(['fifo', 'wsjf'].includes(strategy), 'unsupported strategy')
  const { tasks } = problem
  const selected = new Set()
  const closure = id => {
    const all = new Set([id])
    const crawl = t => { for (const d of byId.get(t).dependsOn) { all.add(d); crawl(d) } }
    crawl(id)
    return all
  }
  const mandatory = tasks.filter(t => t.mandatory)
  for (const t of mandatory) for (const id of closure(t.id)) selected.add(id)
  if (!analyseSelection(selected, byId, problem.budget) && mandatory.length) {
    return { status: 'infeasible', selected: [], utility: 0, effort: 0 }
  }
  const order = [...tasks]
  if (strategy === 'wsjf') order.sort((a, b) =>
    (taskUtility(b, problem.weights) / b.effort - taskUtility(a, problem.weights) / a.effort) || a.id.localeCompare(b.id))
  for (const task of order) {
    const next = new Set([...selected, ...closure(task.id)])
    if (analyseSelection(next, byId, problem.budget)) {
      selected.clear()
      for (const id of next) selected.add(id)
    }
  }
  return { status: 'heuristic', ...resultOf(selected, problem, byId) }
}

/** Feasible list schedule (not an optimal RCPSP solver); workers and roles are explicit. */
export function listSchedule(problem, selectedIds, workers) {
  const byId = validateProblem(problem)
  assert(Array.isArray(workers) && workers.length > 0, 'workers required')
  const workerMap = new Map()
  for (const worker of workers) {
    assert(typeof worker.id === 'string' && worker.id && !workerMap.has(worker.id), 'worker id must be unique')
    assert(Array.isArray(worker.roles), 'worker roles required')
    workerMap.set(worker.id, { ...worker, available: 0 })
  }
  const chosen = resultOf(selectedIds, problem, byId)
  assert(chosen && chosen.selected.length === new Set(selectedIds).size, 'invalid selection')
  const unscheduled = new Set(chosen.selected), completed = new Map(), schedule = []
  while (unscheduled.size) {
    const ready = [...unscheduled].filter(id => byId.get(id).dependsOn.every(d => completed.has(d)))
      .sort((a, b) => taskUtility(byId.get(b), problem.weights) / byId.get(b).effort -
                      taskUtility(byId.get(a), problem.weights) / byId.get(a).effort || a.localeCompare(b))
    assert(ready.length > 0, 'scheduling deadlock')
    const id = ready[0], task = byId.get(id)
    const depsEnd = Math.max(0, ...task.dependsOn.map(d => completed.get(d)))
    const compatible = [...workerMap.values()].filter(w => w.roles.includes(task.role ?? 'forge'))
      .map(w => ({ worker: w, start: Math.max(w.available, depsEnd) }))
      .sort((a, b) => a.start - b.start || a.worker.id.localeCompare(b.worker.id))
    assert(compatible.length, `no compatible worker for ${id}`)
    const { worker, start } = compatible[0], end = start + task.effort
    worker.available = end
    completed.set(id, end)
    schedule.push({ id, workerId: worker.id, start, end })
    unscheduled.delete(id)
  }
  return { schedule, makespan: Math.max(0, ...schedule.map(x => x.end)) }
}

/** EVSI for a binary hidden state, a noisy binary signal and discrete actions. */
export function binaryEvsi({ priorHigh, accuracy, payoff, informationCost = 0 }) {
  assert(Number.isFinite(priorHigh) && priorHigh >= 0 && priorHigh <= 1, 'invalid prior')
  assert(Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 1, 'invalid accuracy')
  assert(Number.isFinite(informationCost) && informationCost >= 0, 'invalid information cost')
  assert(payoff && Object.keys(payoff).length >= 2, 'at least two actions required')
  for (const values of Object.values(payoff))
    assert(Array.isArray(values) && values.length === 2 && values.every(Number.isFinite), 'payoff requires [high, low]')
  const actions = Object.values(payoff)
  const priorValue = Math.max(...actions.map(([high, low]) => priorHigh * high + (1 - priorHigh) * low))
  // Weight each conditional action payoff by P(signal, state). Summing the max
  // across signals equals expected value of decisions after observing the signal.
  const afterHighSignal = Math.max(...actions.map(([high, low]) =>
    priorHigh * accuracy * high + (1 - priorHigh) * (1 - accuracy) * low))
  const afterLowSignal = Math.max(...actions.map(([high, low]) =>
    priorHigh * (1 - accuracy) * high + (1 - priorHigh) * accuracy * low))
  const after = afterHighSignal + afterLowSignal
  return { baselineValue: priorValue, withInformationValue: after,
    evsi: after - priorValue, netValue: after - priorValue - informationCost,
    recommendResearch: after - priorValue > informationCost + 1e-9 }
}
