import { describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { HostAdmissionLedger } from './host-admission-ledger'
import type { AdaptiveScope, AdaptiveRequest } from '../../../../shared/adaptive-delivery/admission-contracts'

const scope: AdaptiveScope = {
  projectId:'project-1',repoId:'repo-1',hostId:'local',baseSha:'a'.repeat(40),
  planId:'plan-1',planSha:'b'.repeat(64),allowedTaskIds:['A','B'],operations:['materialize_run'],
  maxOperations:1,expiresAt:'2099-01-01T00:00:00.000Z'
}
const request: AdaptiveRequest = {
  requestId:'req-1',scopeId:'scope-1',projectId:'project-1',repoId:'repo-1',
  hostId:'local',baseSha:scope.baseSha,planId:'plan-1',planSha:scope.planSha,
  taskIds:['A'],operation:'materialize_run'
}
const clock = Date.parse('2026-11-02T12:00:00Z')
function dbTest(fn: (store: HostAdmissionLedger, db: OrchestrationDb) => void): void {
  const db = new OrchestrationDb(':memory:')
  try { fn(new HostAdmissionLedger(db),db) } finally { db.close() }
}
describe('Host scope/budget admission', () => {
  it('denies absent grants', () => dbTest(store => {
    expect(() => store.reserve(request,clock)).toThrow(/unapproved_scope/)
  }))
  it('accepts one operation, then replays idempotently', () => dbTest(store => {
    store.recordHostApproval('scope-1',scope)
    expect(store.reserve(request,clock).disposition).toBe('new')
    expect(store.reserve(request,clock).disposition).toBe('existing_reserved')
    store.complete(request.requestId,'receipt')
    expect(store.reserve(request,clock)).toEqual({disposition:'completed',receipt:'receipt'})
    expect(() => store.reserve({...request,requestId:'req-2'},clock)).toThrow(/budget_exhausted/)
  }))
  it('blocks mismatched payload and host', () => dbTest(store => {
    store.recordHostApproval('scope-1',scope)
    expect(() => store.reserve({...request,hostId:'remote'},clock)).toThrow(/mismatch:hostId/)
    store.reserve(request,clock)
    expect(() => store.reserve({...request,taskIds:['B']},clock)).toThrow(/request_mismatch/)
  }))
  it('unknown cannot be retried or refunded', () => dbTest(store => {
    store.recordHostApproval('scope-1',scope)
    store.reserve(request,clock)
    store.markUnknown(request.requestId)
    expect(store.reserve(request,clock).disposition).toBe('unknown')
    expect(() => store.complete(request.requestId,'fake')).toThrow(/reconcile first/)
    expect(() => store.reserve({...request,requestId:'req-2'},clock)).toThrow(/budget_exhausted/)
  }))
  it('rejects wrong task, plan hash, base SHA, operation and expired scope', () => dbTest(store => {
    store.recordHostApproval('scope-1',scope)
    expect(() => store.reserve({...request,taskIds:['OUT']},clock)).toThrow(/tasks_out_of_scope/)
    expect(() => store.reserve({...request,planSha:'f'.repeat(64)},clock)).toThrow(/mismatch:planSha/)
    expect(() => store.reserve({...request,baseSha:'f'.repeat(40)},clock)).toThrow(/mismatch:baseSha/)
    expect(() => store.reserve({...request,operation:'agent_turn'},clock)).toThrow(/operation_not_permitted/)
    expect(() => store.reserve(request,Date.parse(scope.expiresAt))).toThrow(/scope_expired/)
  }))
  it('revocation prevents new use but does not erase receipts', () => dbTest(store => {
    store.recordHostApproval('scope-1',scope)
    store.reserve(request,clock)
    store.complete(request.requestId,'receipt')
    store.revoke('scope-1')
    expect(store.reserve(request,clock).disposition).toBe('completed')
    expect(() => store.reserve({...request,requestId:'req-2'},clock)).toThrow(/unapproved_scope/)
  }))
  it('preserves reservations through new service instances', () => dbTest((store,db) => {
    store.recordHostApproval('scope-1',scope)
    store.reserve(request,clock)
    expect(new HostAdmissionLedger(db).reserve(request,clock).disposition).toBe('existing_reserved')
  }))
})
