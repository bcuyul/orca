import { describe, expect, it } from 'vitest'
import type { NativePlanPreview } from './native-plan-preview'
import type { HubNativeStageRecovery } from './project-hub-supervised-stage'
import { evaluateHubWorkerReadiness } from './project-hub-worker-readiness'

const preview: NativePlanPreview = {
  projectId: 'repo:lab', revision: 2, planId: 'plan-1',
  planSha: 'a'.repeat(64), objective: 'Implementar y revisar',
  approval: 'accepted', dispatched: false,
  tasks: [
    { id: 'forge', title: 'Implementar', role: 'forge',
      acceptance: 'Pasan las pruebas', dependsOn: [] },
    { id: 'qa', title: 'Revisar', role: 'qa',
      acceptance: 'No hay regresiones', dependsOn: ['forge'] }
  ]
}
const recovered: HubNativeStageRecovery = {
  status: 'completed_verified', safeToRetry: false, executionAuthorized: false,
  entries: [{
    baseSha: 'b'.repeat(40), state: 'completed', evidence: 'matched',
    disposition: 'completed_verified', runId: 'run-1',
    tasks: { forge: 'native-forge', qa: 'native-qa' },
    recordedTaskCount: 2, unrecordedNativeTaskCount: 0, dispatchCount: 0
  }]
}
const stage = (changes: Partial<HubNativeStageRecovery['entries'][number]>):
  HubNativeStageRecovery => ({
  ...recovered, entries: [{ ...recovered.entries[0]!, ...changes }]
})

describe('Project Hub worker readiness is deny-only', () => {
  it('returns only dependency-free candidates with immutable native IDs', () => {
    const result = evaluateHubWorkerReadiness(preview, recovered)
    expect(result).toMatchObject({
      status: 'candidates-only', runId: 'run-1',
      candidates: [{ taskId: 'forge', nativeTaskId: 'native-forge' }],
      waiting: [{ taskId: 'qa', dependsOn: ['forge'] }],
      executionAuthorized: false, dispatchAllowed: false
    })
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('never treats a human-accepted plan as worker consent', () => {
    expect(evaluateHubWorkerReadiness(preview, null).status).toBe('blocked')
    expect(evaluateHubWorkerReadiness({
      ...preview, approval: 'pending'
    }, recovered).candidates).toEqual([])
    expect(evaluateHubWorkerReadiness({
      ...preview, approval: 'rejected'
    }, recovered).executionAuthorized).toBe(false)
  })

  it('blocks ambiguous, unknown and incomplete recovery', () => {
    for (const status of ['not_found', 'multiple_verified', 'needs_reconciliation'] as const) {
      expect(evaluateHubWorkerReadiness(preview, {
        ...recovered, status
      }).status).toBe('blocked')
    }
    expect(evaluateHubWorkerReadiness(preview, {
      ...recovered, entries: [recovered.entries[0]!, recovered.entries[0]!]
    }).candidates).toEqual([])
    expect(evaluateHubWorkerReadiness(preview, stage({
      state: 'unknown'
    })).status).toBe('blocked')
  })

  it('refuses any previous Dispatch, mismatched DAG or missing host evidence', () => {
    const cases: Partial<HubNativeStageRecovery['entries'][number]>[] = [
      { dispatchCount: 1 }, { unrecordedNativeTaskCount: 1 },
      { recordedTaskCount: 1 }, { evidence: 'divergent' as const },
      { runId: null }, { baseSha: 'bad' },
      { tasks: { forge: 'same', qa: 'same' } },
      { tasks: { forge: 'native-forge' } },
      { tasks: { forge: 'native-forge', qa: 'native-qa', extra: 'other' } }
    ]
    for (const changes of cases) {
      const result = evaluateHubWorkerReadiness(preview, stage(changes))
      expect(result.status).toBe('blocked')
      expect(result.dispatchAllowed).toBe(false)
    }
  })

  it('does not unlock descendants with an unverified agent claim', () => {
    const result = evaluateHubWorkerReadiness({
      ...preview, tasks: preview.tasks.map(t => t.id === 'forge' ?
        { ...t, dependsOn: ['qa'] } : t)
    }, recovered)
    expect(result.status).toBe('blocked')
    expect(result.candidates).toEqual([])
  })
})
