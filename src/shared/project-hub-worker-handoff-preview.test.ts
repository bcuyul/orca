import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import type { NativePlanPreview } from './native-plan-preview'
import type { HubDispatchRecoveryReport } from './project-hub-worker-dispatch-recovery'
import { evaluateHubWorkerReadiness } from './project-hub-worker-readiness'
import type { HubNativeStageRecovery } from './project-hub-supervised-stage'
import { previewHubWorkerHandoff, type HubWorkerHandoffInput } from './project-hub-worker-handoff-preview'

const baseSha = 'a'.repeat(40)
const planSha = 'b'.repeat(64)
const doc = {
  ...emptyProjectHub('repo:handoff-lab'), revision: 3,
  intelligence: {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-handoff', objective: 'PH-001: Crear registro de incidencias',
      rationale: 'Prueba supervisada de implementación y QA independiente',
      source: 'human' as const, createdAt: '2026-11-11T09:00:00Z',
      tasks: [
        { id: 'implement', title: 'Desarrollo: Registrar incidencias',
          role: 'forge' as const, dependsOn: [],
          acceptance: 'La incidencia se registra con su prioridad' },
        { id: 'review', title: 'QA: Comprobar registro',
          role: 'qa' as const, dependsOn: ['implement'],
          acceptance: 'Inspeccionar diff y ejecutar las pruebas' }
      ]
    }],
    decisions: [{
      id: 'human-approved', subject: 'plan' as const,
      subjectId: 'plan-handoff', verdict: 'accepted' as const,
      justification: 'Reviewed the plan and task dependencies',
      createdAt: '2026-11-11T09:01:00Z'
    }]
  }
}
const preview: NativePlanPreview = {
  projectId: doc.projectId, revision: 3, planId: 'plan-handoff',
  planSha, objective: 'PH-001: Crear registro de incidencias',
  approval: 'accepted', dispatched: false,
  tasks: doc.intelligence.plans[0]!.tasks
}
const recovery: HubNativeStageRecovery = {
  status: 'completed_verified', safeToRetry: false,
  executionAuthorized: false, entries: [{
    baseSha, state: 'completed', evidence: 'matched',
    disposition: 'completed_verified', runId: 'run-verified-001',
    tasks: { implement: 'task-native-implement', review: 'task-native-review' },
    recordedTaskCount: 2, unrecordedNativeTaskCount: 0, dispatchCount: 0
  }]
}
const noDispatch: HubDispatchRecoveryReport = {
  status: 'not_found', entries: [], safeToResend: false,
  executionAuthorized: false, deliveryVerified: false
}
function input(): HubWorkerHandoffInput {
  return {
    document: doc, preview,
    readiness: evaluateHubWorkerReadiness(preview, recovery),
    dispatchRecovery: noDispatch, baseSha,
    inventoryStatus: 'successful',
    detectedAgents: ['opencode', 'claude', 'codex'],
    disabledAgents: ['claude']
  }
}

describe('Project Hub single-task handoff draft, zero model calls', () => {
  it('maps verified Run/Task to a detected CLI with escaped implementation instructions', () => {
    const request=input()
    const unchanged=JSON.stringify(request)
    const result=previewHubWorkerHandoff(request)
    expect(result).toMatchObject({
      status: 'draft-only', runId: 'run-verified-001',
      taskId: 'implement', nativeTaskId: 'task-native-implement',
      selectedAgent: 'codex', baseSha,
      executionAuthorized: false, sessionVerified: false, modelCalls: 0
    })
    expect(result.agentOptions).toEqual(['codex', 'opencode'])
    expect(result.waitingFor).toEqual([{ taskId: 'review', dependsOn: ['implement'] }])
    expect(result.prompt).toContain('Native Task: task-native-implement')
    expect(result.prompt).toContain('Expected baseline commit:')
    expect(result.prompt).toContain('La incidencia se registra con su prioridad')
    expect(result.prompt).not.toContain('Native Task: task-native-review')
    expect(JSON.stringify(request)).toBe(unchanged)
  })

  it('accepts a manual CLI preference only when available and enabled', () => {
    expect(previewHubWorkerHandoff({ ...input(), preferredAgent:'opencode' }))
      .toMatchObject({ status:'draft-only', selectedAgent:'opencode' })
    const excluded=previewHubWorkerHandoff({ ...input(), preferredAgent:'claude' })
    expect(excluded.status).toBe('blocked')
    expect(excluded.prompt).toBeNull()
    expect(excluded.blockers.join(' ')).toMatch(/deshabilitado/)
  })

  it('cannot prepare a copy draft without a read-only Dispatch inspection', () => {
    const absent=previewHubWorkerHandoff({ ...input(), dispatchRecovery:null })
    expect(absent.status).toBe('blocked')
    expect(absent.prompt).toBeNull()
    const ambiguous=previewHubWorkerHandoff({
      ...input(), dispatchRecovery:{...noDispatch, status:'needs_reconciliation'}
    })
    expect(ambiguous.status).toBe('blocked')
    const uncertain=previewHubWorkerHandoff({
      ...input(), dispatchRecovery:{
        ...noDispatch, status:'reserved_unobserved',
        entries: [{
          permitRequestId:'permit-1',runId:'run-verified-001',
          taskId:'task-native-implement',dispatchId:'dispatch-1',
          taskStatus:'dispatched',dispatchStatus:'pending',evidence:'matched',
          disposition:'reserved_unobserved'
        }]
      }
    })
    expect(uncertain.prompt).toBeNull()
    expect(uncertain.executionAuthorized).toBe(false)
  })

  it('fails closed for missing approval, stale revision and wrong project', () => {
    for (const wrong of [
      {...input(), preview:{...preview,approval:'pending' as const}},
      {...input(), preview:{...preview,revision:4}},
      {...input(), preview:{...preview,projectId:'repo:other'}},
      {...input(), document:{...doc,intelligence:{...doc.intelligence,decisions:[]}}}
    ]) {
      expect(previewHubWorkerHandoff(wrong).prompt).toBeNull()
    }
  })

  it('cannot route QA or multiple root tasks based on unverified completion', () => {
    const ready=input()
    expect(ready.readiness.waiting).toEqual([
      { taskId:'review',dependsOn:['implement'] }
    ])
    const newReadiness={...ready.readiness,candidates:[
      ...ready.readiness.candidates,
      { taskId:'review',nativeTaskId:'task-native-review',
        title:'QA: Comprobar registro',role:'qa' }
    ]}
    expect(previewHubWorkerHandoff({...ready,readiness:newReadiness}).prompt).toBeNull()
    expect(previewHubWorkerHandoff({
      ...ready,readiness:{...ready.readiness,
        candidates:[{taskId:'review',nativeTaskId:'task-native-review',
          title:'QA: Comprobar registro',role:'qa'}]}
    }).prompt).toBeNull()
  })

  it('never invents a CLI if inventory is pending, failed or disabled', () => {
    for (const inventoryStatus of ['pending','failed','unsupported-host'] as const) {
      const output=previewHubWorkerHandoff({...input(),inventoryStatus})
      expect(output.prompt).toBeNull()
      expect(output.agentOptions).toEqual([])
    }
    const disabled=previewHubWorkerHandoff({
      ...input(),disabledAgents:['claude','codex','opencode']
    })
    expect(disabled.prompt).toBeNull()
  })

  it('rejects unverified Git SHA and never produces a session authorization', () => {
    const output=previewHubWorkerHandoff({...input(),baseSha:'bad'})
    expect(output.status).toBe('blocked')
    expect(output.prompt).toBeNull()
    expect(output.executionAuthorized).toBe(false)
    expect(output.modelCalls).toBe(0)
  })
})
