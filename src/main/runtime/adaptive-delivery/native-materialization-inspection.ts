import { createHash } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { assertAdaptiveRequest, type AdaptiveRequest } from '../../../shared/adaptive-delivery/admission-contracts'
import type { HostAdmissionLedger } from './host-admission-ledger'

export type NativeMaterializationInspection = {
  requestId: string
  state: 'absent' | 'reserved' | 'unknown' | 'completed'
  evidence: 'none' | 'missing' | 'malformed' | 'matched' | 'divergent'
  disposition: 'not_found' | 'manual_reconciliation' | 'completed_verified'
  runId: string | null
  recordedTaskCount: number
  unrecordedNativeTaskCount: number
  dispatchCount: number
  /** Never use an inspection result to authorize a second irreversible write. */
  safeToRetry: false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Host-private, READ-ONLY evidence inspection for partial/uncertain materialization.
 * A checkpoint is not proof of completion: an interrupted write may have created
 * native rows after its last durable checkpoint. Never auto-resume from this result.
 * Not registered on renderer IPC, agent RPC or any CLI/worker start boundary.
 */
export function inspectNativeMaterialization(
  db: OrchestrationDb,
  ledger: HostAdmissionLedger,
  request: AdaptiveRequest
): NativeMaterializationInspection {
  assertAdaptiveRequest(request)
  const entry = ledger.getReservation(request.requestId)
  const state = entry?.state ?? 'absent'
  const initial = {
    requestId: request.requestId, state, runId: null,
    recordedTaskCount: 0, unrecordedNativeTaskCount: 0, dispatchCount: 0,
    safeToRetry: false as const
  }
  if (!entry) {
    return { ...initial, evidence: 'none', disposition: 'not_found' }
  }
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  if (entry.scope_id !== request.scopeId || entry.operation !== request.operation ||
      entry.payload_hash !== hash) {
    throw new Error('request_mismatch')
  }
  if (!entry.receipt) {
    return { ...initial, evidence: 'missing', disposition: 'manual_reconciliation' }
  }

  let raw: unknown
  try { raw = JSON.parse(entry.receipt) }
  catch { return { ...initial, evidence: 'malformed', disposition: 'manual_reconciliation' } }
  if (!isRecord(raw) || typeof raw.runId !== 'string' ||
      raw.runId.length === 0 || raw.runId.length > 200 || !isRecord(raw.tasks)) {
    return { ...initial, evidence: 'malformed', disposition: 'manual_reconciliation' }
  }
  const mapped = Object.entries(raw.tasks)
  if (mapped.length > request.taskIds.length ||
      mapped.some(([key, value]) => !request.taskIds.includes(key) ||
        typeof value !== 'string' || value.length === 0 || value.length > 200)) {
    return { ...initial, evidence: 'malformed', disposition: 'manual_reconciliation' }
  }
  const nativeIds = mapped.map(([, value]) => value as string)
  if (new Set(nativeIds).size !== nativeIds.length) {
    return { ...initial, evidence: 'malformed', disposition: 'manual_reconciliation' }
  }

  const provenance = raw.provenance
  const completedReceiptValid = state !== 'completed' || (
    raw.planId === request.planId && raw.dispatched === false &&
    mapped.length === request.taskIds.length && isRecord(provenance) &&
    (['projectId', 'repoId', 'hostId', 'baseSha', 'planSha'] as const)
      .every((key) => provenance[key] === request[key])
  )
  const checkpointValid = state === 'completed' ? completedReceiptValid : raw.stage === 'creating'
  const runId = raw.runId
  const nativeTasks = db.listTasks({ runId })
  const nativeIdsSet = new Set(nativeIds)
  const unrecordedNativeTaskCount = nativeTasks.filter((task) => !nativeIdsSet.has(task.id)).length
  const allMappedPresent = mapped.every(([, id]) => db.getTask(id as string)?.run_id === runId)
  const dispatch = db.db.prepare(
    'SELECT COUNT(*) AS count FROM dispatch_contexts d JOIN tasks t ON t.id = d.task_id WHERE t.run_id = ?'
  ).get(runId) as { count: number }
  const dispatchCount = dispatch.count
  const evidence = checkpointValid && !!db.getRun(runId) && allMappedPresent &&
    unrecordedNativeTaskCount === 0 && dispatchCount === 0
    ? 'matched' : 'divergent'
  return {
    ...initial, runId, recordedTaskCount: mapped.length,
    unrecordedNativeTaskCount, dispatchCount, evidence,
    disposition: state === 'completed' && evidence === 'matched'
      ? 'completed_verified' : 'manual_reconciliation'
  }
}
