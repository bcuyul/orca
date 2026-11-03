import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { HostAdmissionLedger } from './host-admission-ledger'
import { NativePlanMaterializer } from './native-plan-materializer'
import { inspectNativeMaterialization } from './native-materialization-inspection'
import { emptyProjectHub, type HubDocument } from '../../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../../shared/project-hub-intelligence'
import type { AdaptiveRequest, AdaptiveScope } from '../../../shared/adaptive-delivery/admission-contracts'

const plan: HubPlanProposal = {
  id:'plan-1',objective:'Deliver a booking use case',rationale:'Persist and validate the user flow',
  source:'human',createdAt:'2026-11-02T10:00:00Z',
  tasks:[
    {id:'task-c',title:'Validate booking',role:'qa',dependsOn:['task-b'],acceptance:'Booking case verified'},
    {id:'task-b',title:'Create booking',role:'forge',dependsOn:['task-a'],acceptance:'Create booking works'},
    {id:'task-a',title:'Build storage',role:'data',dependsOn:[],acceptance:'Storage persists bookings'}
  ]
}
const hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
const clock = Date.parse('2026-11-02T12:00:00Z')
const admission: AdaptiveRequest = {
  requestId:'materialize-1', scopeId:'scope-1',projectId:'project-1',repoId:'repo-1',
  hostId:'local',baseSha:'a'.repeat(40),planId:plan.id,planSha:hash,
  taskIds:['task-a','task-b','task-c'],operation:'materialize_run'
}
const scope: AdaptiveScope = {
  projectId:admission.projectId, repoId:admission.repoId,hostId:admission.hostId,
  baseSha:admission.baseSha,planId:plan.id,planSha:hash,allowedTaskIds:['task-a','task-b','task-c'],
  operations:['materialize_run'],maxOperations:1,expiresAt:'2099-01-01T00:00:00Z'
}
const buildDoc = (approved=true): HubDocument => ({
  ...emptyProjectHub('project-1'),revision:2,
  intelligence:{...emptyHubIntelligence(),plans:[plan],
    decisions: approved ? [{
      id:'decision-1',subject:'plan',subjectId:plan.id,verdict:'accepted',
      justification:'Reviewed task acceptance and deps',createdAt:'2026-11-02T10:15:00Z'
    }] : []}
})
function harness(fn:(h: {
  db: OrchestrationDb; ledger: HostAdmissionLedger;
  bridge: NativePlanMaterializer; doc: HubDocument
})=>void,approved=true): void {
  const db = new OrchestrationDb(':memory:')
  const ledger = new HostAdmissionLedger(db)
  const doc = buildDoc(approved)
  const reader = {read:(projectId:string) => {
    if (projectId !== doc.projectId) { throw new Error('Missing project') }
    return doc
  }}
  const bridge = new NativePlanMaterializer(db,ledger,reader)
  try { fn({db,ledger,bridge,doc}) } finally { db.close() }
}
describe('native plan materializer: real Run/Task rows, no workers',()=>{
  it('creates native Run and ordered Task dependencies once with no Dispatch',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    const result = bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})
    expect(result.dispatched).toBe(false)
    expect(db.getRun(result.runId)?.id).toBe(result.runId)
    const a = db.getTask(result.tasks['task-a'])
    const b = db.getTask(result.tasks['task-b'])
    const c = db.getTask(result.tasks['task-c'])
    expect(a?.status).toBe('ready')
    expect(b?.status).toBe('pending')
    expect(c?.status).toBe('pending')
    expect(JSON.parse(b!.deps)).toEqual([a?.id])
    expect(JSON.parse(c!.deps)).toEqual([b?.id])
    expect(db.listTasks({runId:result.runId})).toHaveLength(3)
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_contexts').get()).toMatchObject({n:0})
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM coordinator_runs').get()).toMatchObject({n:0})
    expect(bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})).toEqual(result)
    expect(db.listRuns().runs.filter(run => run.legacy === 0)).toHaveLength(1)
  }))
  it('refuses a plan without accepted human decision',()=>harness(({ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})).toThrow(/human-approved/)
    expect(ledger.getReservation(admission.requestId)).toBeUndefined()
  },false))
  it('refuses revision, SHA, and partial task subsets before side effects',()=>harness(({ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    expect(()=>bridge.materialize({admission,expectedHubRevision:1,nowMs:clock})).toThrow(/revision/)
    expect(()=>bridge.materialize({admission:{...admission,planSha:'f'.repeat(64)},expectedHubRevision:2,nowMs:clock})).toThrow(/SHA/)
    expect(()=>bridge.materialize({admission:{...admission,taskIds:['task-a']},expectedHubRevision:2,nowMs:clock})).toThrow(/Complete plan/)
    expect(ledger.getReservation(admission.requestId)).toBeUndefined()
  }))
  it('on mid-creation failure preserves checkpoint and unknown, never repeats',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    vi.spyOn(db,'createTask').mockImplementationOnce(()=>{throw new Error('simulated disk failure')})
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})).toThrow(/simulated/)
    const attempt=ledger.getReservation(admission.requestId)
    expect(attempt?.state).toBe('unknown')
    expect(attempt?.receipt).toContain('runId')
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})).toThrow(/reconcile/)
    expect(db.listRuns().runs.filter(run => run.legacy === 0)).toHaveLength(1)
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_contexts').get()).toMatchObject({n:0})
  }))
  it('does not create a new Run when scope is not granted',()=>harness(({db,bridge})=>{
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})).toThrow(/unapproved_scope/)
    expect(db.listRuns().runs.filter(run => run.legacy === 0)).toHaveLength(0)
  }))
  it('inspects a completed Run/Task receipt without starting workers or writing data',()=>harness(({db,ledger,bridge})=>{
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'absent',evidence:'none',disposition:'not_found',safeToRetry:false
    })
    ledger.recordHostApproval('scope-1',scope)
    const receipt=bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'completed',evidence:'matched',disposition:'completed_verified',
      runId:receipt.runId,recordedTaskCount:3,unrecordedNativeTaskCount:0,
      dispatchCount:0,safeToRetry:false
    })
    expect(db.listRuns().runs.filter(run=>run.legacy===0)).toHaveLength(1)
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM coordinator_runs').get()).toMatchObject({n:0})
  }))
  it('keeps reservations and unknown partial writes under manual-only reconciliation',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    ledger.reserve(admission,clock)
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'reserved',evidence:'missing',disposition:'manual_reconciliation',safeToRetry:false
    })
    expect(()=>inspectNativeMaterialization(db,ledger,{...admission,taskIds:['task-a']}))
      .toThrow(/request_mismatch/)
    // A real restart can encounter a reserved checkpoint without the final receipt.
    ledger.checkpoint(admission.requestId,JSON.stringify({stage:'creating',runId:'missing-run',tasks:{}}))
    ledger.markUnknown(admission.requestId)
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'unknown',evidence:'divergent',disposition:'manual_reconciliation',
      runId:'missing-run',safeToRetry:false
    })
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock}))
      .toThrow(/reconcile/)
    expect(db.listRuns().runs.filter(run=>run.legacy===0)).toHaveLength(0)
  }))
  it('never auto-retries a real interrupted native write even when checkpoint rows match',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    vi.spyOn(db,'createTask').mockImplementationOnce(()=>{throw new Error('simulated interrupted task')})
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock}))
      .toThrow(/simulated interrupted task/)
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'unknown',evidence:'matched',disposition:'manual_reconciliation',
      recordedTaskCount:0,safeToRetry:false
    })
    expect(db.listRuns().runs.filter(run=>run.legacy===0)).toHaveLength(1)
  }))
  it('detects a forged duplicate native-task mapping and refuses idempotent replay',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    const result=bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})
    const tampered={...result,tasks:{...result.tasks,'task-b':result.tasks['task-a']}}
    db.db.prepare('UPDATE adaptive_admissions SET receipt=? WHERE request_id=?')
      .run(JSON.stringify(tampered),admission.requestId)
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'completed',evidence:'malformed',disposition:'manual_reconciliation'
    })
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock}))
      .toThrow(/Completed receipt stale or corrupt/)
    expect(db.listRuns().runs.filter(run=>run.legacy===0)).toHaveLength(1)
  }))
  it('detects uncheckpointed native Tasks even if receipt says completed',()=>harness(({db,ledger,bridge})=>{
    ledger.recordHostApproval('scope-1',scope)
    const result=bridge.materialize({admission,expectedHubRevision:2,nowMs:clock})
    db.createTask({runId:result.runId,taskTitle:'Unexpected native task',
      displayName:'Unexpected native task',spec:'manual inspection fixture',deps:[]})
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'completed',evidence:'divergent',unrecordedNativeTaskCount:1,
      disposition:'manual_reconciliation',safeToRetry:false
    })
    expect(()=>bridge.materialize({admission,expectedHubRevision:2,nowMs:clock}))
      .toThrow(/Completed receipt stale or corrupt/)
  }))
  it('treats corrupted checkpoint JSON as untrusted evidence, without writes',()=>harness(({db,ledger})=>{
    ledger.recordHostApproval('scope-1',scope)
    ledger.reserve(admission,clock)
    ledger.checkpoint(admission.requestId,'{invalid-json')
    ledger.markUnknown(admission.requestId)
    expect(inspectNativeMaterialization(db,ledger,admission)).toMatchObject({
      state:'unknown',evidence:'malformed',disposition:'manual_reconciliation',
      safeToRetry:false
    })
    expect(db.listRuns().runs.filter(run=>run.legacy===0)).toHaveLength(0)
  }))

})
