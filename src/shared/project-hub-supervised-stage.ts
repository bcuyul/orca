/** An explicit host-confirmed write: creates a quarantined native Run/Task DAG, never Dispatch. */
export type HubStageNativePlanRequest = {
  projectId: string
  planId: string
  expectedRevision: number
  planSha: string
  worktreeId: string
}

export type HubStagedNativePlan = {
  status: 'staged'
  projectId: string
  planId: string
  runId: string
  tasks: Record<string, string>
  baseSha: string
  reused: boolean
  dispatched: false
}

export type HubStageNativePlanResult =
  | { status: 'cancelled' }
  | HubStagedNativePlan

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function isHubStageNativePlanRequest(value: unknown): value is HubStageNativePlanRequest {
  if (!record(value)) { return false }
  return typeof value.projectId === 'string' && value.projectId.length > 0 &&
    value.projectId.length <= 500 &&
    typeof value.planId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value.planId) &&
    Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0 &&
    typeof value.planSha === 'string' && /^[a-f0-9]{64}$/i.test(value.planSha) &&
    typeof value.worktreeId === 'string' && value.worktreeId.length > 0 &&
    value.worktreeId.length <= 600
}


/** Read-only recovery request; no host grant or execution authority. */
export type HubInspectNativeStageRequest = HubStageNativePlanRequest
export type HubNativeStageEvidence = {
  baseSha: string
  state: 'absent' | 'reserved' | 'unknown' | 'completed'
  evidence: 'none' | 'missing' | 'malformed' | 'matched' | 'divergent'
  disposition: 'completed_verified' | 'manual_reconciliation'
  runId: string | null
  tasks: Record<string, string> | null
  recordedTaskCount: number
  unrecordedNativeTaskCount: number
  dispatchCount: number
}
export type HubNativeStageRecovery = {
  status: 'not_found' | 'completed_verified' | 'multiple_verified' | 'needs_reconciliation'
  entries: HubNativeStageEvidence[]
  safeToRetry: false
  executionAuthorized: false
}
