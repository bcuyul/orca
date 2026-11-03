import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { HubDocument } from '../../../shared/project-hub-types'
import { buildNativePlanPreview } from '../../project-hub/native-plan-preview'
import { assertAdaptiveRequest, type AdaptiveRequest } from '../../../shared/adaptive-delivery/admission-contracts'
import type { HostAdmissionLedger } from './host-admission-ledger'
import { inspectNativeMaterialization } from './native-materialization-inspection'

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
  /** Immutable identity from the host-validated materialization request. */
  provenance: Pick<AdaptiveRequest, 'projectId' | 'repoId' | 'hostId' | 'baseSha' | 'planSha'>
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
    assertAdaptiveRequest(request)
    if (request.operation !== 'materialize_run') { throw new Error('materialize_run required') }
    if (!Number.isSafeInteger(input.expectedHubRevision) || input.expectedHubRevision < 0) {
      throw new Error('Invalid Project Hub revision')
    }
    const doc = this.projects.read(request.projectId)
    if (doc.projectId !== request.projectId) { throw new Error('Project Hub revision/identity mismatch') }
    const preview = buildNativePlanPreview(doc, request.planId, input.expectedHubRevision)
    if (preview.approval !== 'accepted') { throw new Error('Plan not human-approved') }
    if (preview.planSha !== request.planSha) { throw new Error('Plan SHA does not match proposal') }
    const submittedIds = [...request.taskIds].sort()
    const planIds = preview.tasks.map((task) => task.id).sort()
    if (JSON.stringify(submittedIds) !== JSON.stringify(planIds)) {
      throw new Error('Complete plan task set required')
    }
    const reservation = this.ledger.reserve(request,input.nowMs)
    if (reservation.disposition === 'completed') {
      if (!reservation.receipt ||
          inspectNativeMaterialization(this.db, this.ledger, request).disposition !==
            'completed_verified') {
        throw new Error('Completed receipt stale or corrupt; reconcile')
      }
      return JSON.parse(reservation.receipt) as NativeMaterialization
    }
    if (reservation.disposition !== 'new') {
      throw new Error('Uncertain or pending materialization; reconcile before retry')
    }

    let started = false
    try {
      started = true
      const run = this.db.createRun({
        objective: preview.objective,
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      const tasks: Record<string,string> = {}
      this.ledger.checkpoint(request.requestId, JSON.stringify({ stage:'creating',runId:run.id,tasks }))
      for (const task of preview.tasks) {
        const native = this.db.createTask({
          runId:run.id,
          taskTitle:task.title,
          displayName:task.title,
          // Stored as untrusted task data, not an agent-turn authorization.
          spec:JSON.stringify({source:'adaptive-untrusted-plan',objective:preview.objective,
            role:task.role, title:task.title, acceptance:task.acceptance}),
          deps:task.dependsOn.map(id => tasks[id])
        })
        tasks[task.id] = native.id
        this.ledger.checkpoint(request.requestId, JSON.stringify({ stage:'creating',runId:run.id,tasks }))
      }
      const result: NativeMaterialization = {
        runId: run.id, planId: preview.planId, tasks, dispatched: false,
        provenance: {
          projectId: request.projectId, repoId: request.repoId, hostId: request.hostId,
          baseSha: request.baseSha, planSha: request.planSha
        }
      }
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
