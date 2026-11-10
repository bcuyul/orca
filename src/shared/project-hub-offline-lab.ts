/** Local, synthetic Coordinator test contract. Never grants execution authority. */
export type HubOfflineLabRequest = { projectId: string }

export type HubOfflineLabReport = {
  kind: 'synthetic-memory-only'
  status: 'passed'
  stagedRunQuarantined: true
  syntheticRunCompleted: true
  foreignRunUnchanged: true
  fakeWorkerTurns: 1
  syntheticDispatches: 1
  terminalCreations: 0
  modelCalls: 0
  executionAuthorized: false
  events: readonly string[]
}

export function isHubOfflineLabRequest(value: unknown): value is HubOfflineLabRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false }
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 1 &&
    typeof request.projectId === 'string' &&
    request.projectId.length > 0 && request.projectId.length <= 500
}
