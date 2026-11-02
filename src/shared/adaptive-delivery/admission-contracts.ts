/** Advisory-only data. Host-authenticated approval is required before writing a grant. */
export type AdaptiveOperation = 'materialize_run' | 'agent_turn'
export type AdaptiveScope = {
  projectId: string
  repoId: string
  hostId: string
  baseSha: string
  planId: string
  planSha: string
  allowedTaskIds: string[]
  operations: AdaptiveOperation[]
  maxOperations: number
  expiresAt: string
}
export type AdaptiveRequest = {
  requestId: string
  scopeId: string
  projectId: string
  repoId: string
  hostId: string
  baseSha: string
  planId: string
  planSha: string
  taskIds: string[]
  operation: AdaptiveOperation
}
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{0,199}$/
const SHA = /^[0-9a-f]{40}$/i
const DIGEST = /^[0-9a-f]{64}$/i
const OPERATIONS = new Set(['materialize_run', 'agent_turn'])
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 &&
  v.length <= 20 && v.every(x => typeof x === 'string' && NAME.test(x)) &&
  new Set(v).size === v.length

export function assertAdaptiveScope(raw: unknown): asserts raw is AdaptiveScope {
  if (!obj(raw) || !NAME.test(String(raw.projectId)) || !NAME.test(String(raw.repoId)) ||
      !NAME.test(String(raw.hostId)) || !NAME.test(String(raw.planId)) ||
      !SHA.test(String(raw.baseSha)) || !DIGEST.test(String(raw.planSha)) ||
      !names(raw.allowedTaskIds) || !Array.isArray(raw.operations) ||
      raw.operations.length < 1 || raw.operations.length > 2 ||
      !raw.operations.every(x => OPERATIONS.has(String(x))) ||
      new Set(raw.operations).size !== raw.operations.length ||
      !Number.isSafeInteger(raw.maxOperations) || Number(raw.maxOperations) < 1 ||
      Number(raw.maxOperations) > 100 || typeof raw.expiresAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(raw.expiresAt) ||
      !Number.isFinite(Date.parse(raw.expiresAt))) {
    throw new Error('Invalid adaptive scope')
  }
}
export function assertAdaptiveRequest(raw: unknown): asserts raw is AdaptiveRequest {
  if (!obj(raw) || !NAME.test(String(raw.requestId)) || !NAME.test(String(raw.scopeId)) ||
      !NAME.test(String(raw.projectId)) || !NAME.test(String(raw.repoId)) ||
      !NAME.test(String(raw.hostId)) || !NAME.test(String(raw.planId)) ||
      !SHA.test(String(raw.baseSha)) || !DIGEST.test(String(raw.planSha)) ||
      !names(raw.taskIds) || !OPERATIONS.has(String(raw.operation))) {
    throw new Error('Invalid adaptive request')
  }
}
export function evaluateAdaptiveScope(
  scope: AdaptiveScope, request: AdaptiveRequest, reserved: number, now: number
): { allowed: boolean; reasons: string[] } {
  assertAdaptiveScope(scope)
  assertAdaptiveRequest(request)
  if (!Number.isSafeInteger(reserved) || reserved < 0 || !Number.isFinite(now)) {
    throw new Error('Invalid accounting')
  }
  const reasons: string[] = []
  for (const field of ['projectId','repoId','hostId','baseSha','planId','planSha'] as const) {
    if (scope[field] !== request[field]) { reasons.push(`mismatch:${field}`) }
  }
  if (!scope.operations.includes(request.operation)) { reasons.push('operation_not_permitted') }
  if (request.taskIds.some(id => !scope.allowedTaskIds.includes(id))) { reasons.push('tasks_out_of_scope') }
  if (now >= Date.parse(scope.expiresAt)) { reasons.push('scope_expired') }
  if (reserved >= scope.maxOperations) { reasons.push('budget_exhausted') }
  return { allowed: reasons.length === 0, reasons }
}
