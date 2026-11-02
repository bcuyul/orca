import { createHash } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  assertAdaptiveScope, assertAdaptiveRequest, evaluateAdaptiveScope,
  type AdaptiveScope, type AdaptiveRequest
} from '../../../shared/adaptive-delivery/admission-contracts'

const INIT_SQL = [
  'CREATE TABLE IF NOT EXISTS adaptive_scope_grants (id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)',
  "CREATE TABLE IF NOT EXISTS adaptive_admissions (request_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, payload_hash TEXT NOT NULL, operation TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','unknown','completed')), receipt TEXT)",
  'CREATE INDEX IF NOT EXISTS adaptive_admissions_by_scope ON adaptive_admissions(scope_id)'
].concat('').join(';')

type GrantRow = { scope_json: string; revoked: number }
type AttemptRow = { request_id: string; scope_id: string; payload_hash: string; operation: string;
  state: 'reserved' | 'unknown' | 'completed'; receipt: string | null }
export type AdmissionOutcome = { disposition: 'new'|'existing_reserved'|'unknown'|'completed'; receipt: string|null }
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{0,199}$/

/**
 * PRIVATE host-only admission ledger. No renderer, RPC or agent can call it.
 * recordHostApproval is NOT an authenticated entrypoint; the future host
 * mutation must validate a real human decision before invoking it.
 */
export class HostAdmissionLedger {
  constructor(private readonly database: OrchestrationDb) { database.db.exec(INIT_SQL) }

  recordHostApproval(id: string, scope: AdaptiveScope): void {
    if (!ID.test(id)) { throw new Error('Invalid scope ID') }
    assertAdaptiveScope(scope)
    this.database.db.prepare('INSERT INTO adaptive_scope_grants (id,scope_json) VALUES (?,?)')
      .run(id, JSON.stringify(scope))
  }

  revoke(id: string): void {
    const result = this.database.db.prepare(
      'UPDATE adaptive_scope_grants SET revoked = 1 WHERE id = ? AND revoked = 0'
    ).run(id)
    if (result.changes !== 1) { throw new Error('Scope not active') }
  }

  getReservation(id: string): AttemptRow | undefined {
    if (!ID.test(id)) { throw new Error('Invalid request ID') }
    return this.database.db.prepare(
      'SELECT request_id,scope_id,payload_hash,operation,state,receipt FROM adaptive_admissions WHERE request_id = ?'
    ).get(id) as AttemptRow | undefined
  }

  reserve(request: AdaptiveRequest, nowMs: number): AdmissionOutcome {
    assertAdaptiveRequest(request)
    if (!Number.isFinite(nowMs)) { throw new Error('Invalid clock') }
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    this.database.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.getReservation(request.requestId)
      if (previous) {
        if (previous.scope_id !== request.scopeId || previous.payload_hash !== hash ||
            previous.operation !== request.operation) { throw new Error('request_mismatch') }
        this.database.db.exec('COMMIT')
        return { disposition: previous.state === 'reserved' ? 'existing_reserved' : previous.state,
          receipt: previous.receipt }
      }
      const grant = this.database.db.prepare(
        'SELECT scope_json,revoked FROM adaptive_scope_grants WHERE id = ?'
      ).get(request.scopeId) as GrantRow | undefined
      if (!grant || grant.revoked !== 0) { throw new Error('unapproved_scope') }
      const raw: unknown = JSON.parse(grant.scope_json)
      assertAdaptiveScope(raw)
      const counted = this.database.db.prepare(
        'SELECT COUNT(*) AS count FROM adaptive_admissions WHERE scope_id = ?'
      ).get(request.scopeId) as { count: number }
      const decision = evaluateAdaptiveScope(raw, request, counted.count, nowMs)
      if (!decision.allowed) { throw new Error(`admission_denied:${decision.reasons.join(',')}`) }
      this.database.db.prepare(
        "INSERT INTO adaptive_admissions (request_id,scope_id,payload_hash,operation,state) VALUES (?,?,?,?,'reserved')"
      ).run(request.requestId,request.scopeId,hash,request.operation)
      this.database.db.exec('COMMIT')
      return { disposition: 'new', receipt: null }
    } catch(error) {
      this.database.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Ambiguous outcomes keep the budget reservation. Never blindly retry. */
  markUnknown(id: string): void {
    if (this.database.db.prepare(
      "UPDATE adaptive_admissions SET state='unknown' WHERE request_id=? AND state='reserved'"
    ).run(id).changes !== 1) { throw new Error('Request not reserved') }
  }

  complete(id: string, receipt: string): void {
    if (!receipt || receipt.length > 20_000) { throw new Error('Invalid receipt') }
    if (this.database.db.prepare(
      "UPDATE adaptive_admissions SET state='completed',receipt=? WHERE request_id=? AND state='reserved'"
    ).run(receipt,id).changes !== 1) { throw new Error('Request not reserved; reconcile first') }
  }
}
