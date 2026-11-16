import { describe, expect, it } from 'vitest'
import { emptyProjectHub, type HubDocument } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import {
  HUB_CODE_MODE_READ_TOOLS, runHubCodeModeReadOnly, searchHubCodeModeTools
} from './project-hub-code-mode-readonly'

function snapshot(): HubDocument {
  const doc = emptyProjectHub('repo:code-mode')
  return {
    ...doc,
    revision: 2,
    items: [
      { id: 'PH-001', title: 'Mostrar backlog', type: 'story', status: 'ready',
        phase: 1, source: 'local', acceptance: 'Se presenta el backlog',
        description: '' },
      { id: 'PH-002', title: 'Tarea antigua', type: 'task', status: 'done',
        phase: 1, source: 'local', acceptance: 'Terminada', description: '',
        archived: true }
    ],
    intelligence: {
      ...emptyHubIntelligence(),
      plans: [{
        id: 'plan-1', objective: 'Auditar el proyecto',
        rationale: 'Conocer tareas y dependencias',
        source: 'human', createdAt: '2026-11-16T12:00:00Z',
        tasks: [{ id: 'implement', title: 'Implementación de prueba',
          role: 'forge', dependsOn: [], acceptance: 'Verificar el resultado' }]
      }],
      decisions: [{
        id: 'decision-1', subject: 'plan', subjectId: 'plan-1',
        verdict: 'accepted', justification: 'Revisé dependencias y criterios',
        createdAt: '2026-11-16T12:01:00Z'
      }]
    }
  }
}

describe('Project Hub local Code Mode — safe read-only recipe', () => {
  it('combines three snapshot tools without external calls, model usage or mutations', () => {
    const doc = snapshot()
    const original = JSON.stringify(doc)
    const result = runHubCodeModeReadOnly(doc, doc.projectId)

    expect(result).toMatchObject({
      status: 'complete', projectId: 'repo:code-mode', revision: 2,
      toolCalls: 3, externalCalls: 0, modelCalls: 0,
      executionAuthorized: false, generatedCodeExecuted: false
    })
    expect(result.steps.map(step => step.tool)).toEqual([...HUB_CODE_MODE_READ_TOOLS])
    expect(result.steps[0]?.result).toMatchObject({
      active: 1, archived: 1, byStatus: { ready: 1, done: 0 }
    })
    expect(result.steps[1]?.result).toMatchObject({
      plans: 1, tasks: 1, acceptedPlans: 1
    })
    expect(result.steps[2]?.result).toMatchObject({
      total: 0, byStatus: { planned: 0, unconfirmed: 0 }
    })
    expect(JSON.stringify(doc)).toBe(original)
  })

  it('never reads a mismatched or invalid project snapshot', () => {
    const doc = snapshot()
    expect(runHubCodeModeReadOnly(doc, 'repo:another')).toMatchObject({
      status: 'blocked', steps: [], toolCalls: 0,
      executionAuthorized: false
    })
    const invalid = { ...doc, revision: -1 }
    expect(runHubCodeModeReadOnly(invalid, doc.projectId).status).toBe('blocked')
  })

  it('rejects duplicate and unknown tools instead of interpreting arbitrary code', () => {
    const doc = snapshot()
    expect(runHubCodeModeReadOnly(doc, doc.projectId, [
      'hub.backlog.summary', 'hub.backlog.summary'
    ]).status).toBe('blocked')
    expect(runHubCodeModeReadOnly(doc, doc.projectId, [
      'hub.backlog.summary', 'host.exec' as 'hub.plans.summary'
    ])).toMatchObject({
      status: 'blocked', toolCalls: 0, generatedCodeExecuted: false
    })
    expect(runHubCodeModeReadOnly(doc, doc.projectId, []).status).toBe('blocked')
  })

  it('discovers only allowlisted read-only tools', () => {
    expect(searchHubCodeModeTools('backlog').map(tool => tool.id))
      .toEqual(['hub.backlog.summary'])
    expect(searchHubCodeModeTools('host.exec')).toEqual([])
    expect(searchHubCodeModeTools('')).toHaveLength(3)
  })

  it('marks launched and unconfirmed as ledger states, not completed work', () => {
    const doc = snapshot()
    const result = runHubCodeModeReadOnly(doc, doc.projectId,
      ['hub.delegations.summary'])
    expect(result.steps[0]?.result.note).toMatch(/never be retried/)
    expect(result.executionAuthorized).toBe(false)
  })
})
