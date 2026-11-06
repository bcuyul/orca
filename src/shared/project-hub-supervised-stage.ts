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
