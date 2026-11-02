import { createHash } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { HubDocument } from '../../../shared/project-hub-types'
import { isHubDocument } from '../../../shared/project-hub-types'
import { isHubPlanProposal, type HubPlanProposal } from '../../../shared/project-hub-intelligence'
import type { AdaptiveRequest } from '../../../shared/adaptive-delivery/admission-contracts'
import type { HostAdmissionLedger } from './host-admission-ledger'

export type MaterializeRequest = {
  admission: AdaptiveRequest
  /** CAS against the authoritative ProjectHubStore projection. */
  expectedHubRevision: number
  nowMs: number
}
export type NativeMaterialization = {
  runId: string
  planId: string
  tasks: Record<string, string>
  /** This is not a Coordinator execution, agent launch, or QA. */
  dispatched: false
}
type PlanReader = { read(projectId: string): HubDocument }

/**
 * HOST-ONLY, CONTROL PLANE ONLY. Uses native Orca Run/Task methods.
 * Does not call createCoordinatorRun, Coordinator.run(), Dispatch or an agent CLI.
 * Before exposing over RPC, authenticated human approval/host ownership MUST be
 * verified by an independent host mutation boundary.
 */
export class NativePlanMaterializer {
  constructor(
    private readonly db: OrchestrationDb,
    private readonly ledger: HostAdmissionLedger,
    private readonly projects: PlanReader
  ) {}

  materialize(input: MaterializeRequest): NativeMaterialization {
    const request = input.admission
    if (request.operation !== 'materialize_run') { throw new Error('materialize_run required') }
    if (!Number.isSafeInteger(input.expectedHubRevision) || input.expectedHubRevision < 0) {
      throw new Error('Invalid Project Hub revision')
    }
    const doc = this.projects.read(request.projectId)
    if (!isHubDocument(doc) || doc.projectId !== request.projectId ||
        doc.revision !== input.expectedHubRevision) { throw new Error('Project Hub revision/identity mismatch') }
    const plan = doc.intelligence?.plans.find(x => x.id === request.planId)
    if (!plan || !isHubPlanProposal(plan)) { throw new Error('Plan missing or invalid') }
    const approved = doc.intelligence?.decisions.some(x =>
      x.subject === 'plan' && x.subjectId === plan.id && x.verdict === 'accepted')
    if (!approved) { throw new Error('Plan not human-approved') }
    const planSha = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
    if (planSha !== request.planSha) { throw new Error('Plan SHA does not match proposal') }
    const submittedIds = [...request.taskIds].sort()
    const planIds = plan.tasks.map(x => x.id).sort()
    if (JSON.stringify(submittedIds) !== JSON.stringify(planIds)) {
      throw new Error('Complete plan task set required')
    }
    const reservation = this.ledger.reserve(request,input.nowMs)
    if (reservation.disposition === 'completed') {
      if (!reservation.receipt) { throw new Error('Missing completed receipt') }
      const result = JSON.parse(reservation.receipt) as NativeMaterialization
      if (!result || result.planId !== plan.id || !this.db.getRun(result.runId) ||
          Object.entries(result.tasks).length !== plan.tasks.length ||
          !Object.values(result.tasks).every(id => this.db.getTask(id)?.run_id === result.runId)) {
        throw new Error('Completed receipt stale or corrupt; reconcile')
      }
      return result
    }
    if (reservation.disposition !== 'new') {
      throw new Error('Uncertain or pending materialization; reconcile before retry')
    }

    let started = false
    try {
      started = true
      const run = this.db.createRun({
        objective: plan.objective,
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      const tasks: Record<string,string> = {}
      this.ledger.checkpoint(request.requestId, JSON.stringify({ stage:'creating',runId:run.id,tasks }))
      for (const task of topologicalTasks(plan)) {
        const native = this.db.createTask({
          runId:run.id,
          taskTitle:task.title,
          displayName:task.title,
          // Stored as untrusted task data, not an agent-turn authorization.
          spec:JSON.stringify({source:'adaptive-untrusted-plan',objective:plan.objective,
            role:task.role, title:task.title, acceptance:task.acceptance}),
          deps:task.dependsOn.map(id => tasks[id])
        })
        tasks[task.id] = native.id
        this.ledger.checkpoint(request.requestId, JSON.stringify({ stage:'creating',runId:run.id,tasks }))
      }
      const result: NativeMaterialization = { runId:run.id, planId:plan.id, tasks, dispatched:false }
      this.ledger.complete(request.requestId,JSON.stringify(result))
      return result
    } catch(error) {
      // Even if Run/Task creation partially succeeded, never create a second Run.
      if (started && this.ledger.getReservation(request.requestId)?.state === 'reserved') {
        this.ledger.markUnknown(request.requestId)
      }
      throw error
    }
  }
}

/** Stable topological order; native createTask requires predecessors to exist. */
function topologicalTasks(plan: HubPlanProposal): HubPlanProposal['tasks'] {
  const byId = new Map(plan.tasks.map(task => [task.id,task]))
  const done = new Set<string>()
  const ordered: HubPlanProposal['tasks'] = []
  const visit = (id:string): void => {
    if (done.has(id)) { return }
    const task = byId.get(id)
    if (!task) { throw new Error('Unknown plan dependency') }
    for (const dependency of [...task.dependsOn].sort()) { visit(dependency) }
    ordered.push(task)
    done.add(id)
  }
  for (const task of [...plan.tasks].sort((a,b)=>a.id.localeCompare(b.id,'en'))) { visit(task.id) }
  return ordered
}
