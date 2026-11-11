/**
 * Advisory recovery readout, never a capability or command.
 * Even a matched Dispatch is not proof that a model received a prompt.
 */
export type HubDispatchRecoveryEntry = {
  permitRequestId: string
  runId: string
  taskId: string
  dispatchId: string
  taskStatus: string | null
  dispatchStatus: string | null
  evidence: 'matched' | 'divergent'
  disposition: 'reserved_unobserved' | 'settled_unverified' | 'manual_reconciliation'
}
export type HubDispatchRecoveryReport = {
  status: 'not_found' | 'reserved_unobserved' |
    'settled_unverified' | 'needs_reconciliation'
  entries: HubDispatchRecoveryEntry[]
  safeToResend: false
  executionAuthorized: false
  deliveryVerified: false
}
