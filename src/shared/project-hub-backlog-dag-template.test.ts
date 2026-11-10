import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence, isHubPlanProposal } from './project-hub-intelligence'
import { buildHubBacklogDagTemplate } from './project-hub-backlog-dag-template'

const stamp = '2026-11-10T13:00:00.000Z'
const doc = {
  ...emptyProjectHub('repo:lab'), revision: 1,
  items: [
    {
      id: 'PH-101', title: 'Registrar una solicitud', type: 'story' as const,
      status: 'ready' as const, phase: 1, source: 'manual',
      description: 'Registrar el origen de la solicitud y persistir historial.',
      acceptance: 'La solicitud aparece en el historial.'
    },
    {
      id: 'PH-102', title: 'Caso sin requisitos', type: 'task' as const,
      status: 'backlog' as const, phase: 1, source: 'manual',
      description: '', acceptance: ''
    },
    {
      id: 'PH-103', title: 'Tarea ya completada', type: 'task' as const,
      status: 'done' as const, phase: 1, source: 'manual',
      description: '', acceptance: 'Se verificó previamente.'
    }
  ],
  intelligence: emptyHubIntelligence()
}
const params = {
  storyId: 'PH-101', planId: 'plan-generated', createdAt: stamp,
  implementationRole: 'forge' as const
}

describe('deterministic Project Hub backlog DAG template', () => {
  it('produces a bounded, valid Forge → QA DAG without models', () => {
    const result = buildHubBacklogDagTemplate(doc, params)
    expect(isHubPlanProposal(result)).toBe(true)
    expect(result).toMatchObject({
      objective: 'PH-101: Registrar una solicitud',
      source: 'human',
      tasks: [
        { id: 'implement', role: 'forge', dependsOn: [] },
        { id: 'review', role: 'qa', dependsOn: ['implement'] }
      ]
    })
    expect(result.rationale).toMatch(/Sin IA, no ejecuta agentes/)
    expect(result.tasks[0]?.acceptance).toContain(doc.items[0]!.acceptance)
  })

  it.each(['data', 'flow'] as const)('preserves explicit %s role, never guesses from text', role => {
    const proposal = buildHubBacklogDagTemplate(doc, {
      ...params, implementationRole: role
    })
    expect(proposal.tasks[0]?.role).toBe(role)
    expect(proposal.tasks[1]?.role).toBe('qa')
  })

  it('is deterministic for identical input, without timestamps or random IDs', () => {
    expect(buildHubBacklogDagTemplate(doc, params))
      .toEqual(buildHubBacklogDagTemplate(doc, params))
  })

  it('rejects duplicate proposals for the same backlog item', () => {
    const earlier = buildHubBacklogDagTemplate(doc, params)
    const existing = {
      ...doc, intelligence: { ...doc.intelligence, plans: [earlier] }
    }
    expect(() => buildHubBacklogDagTemplate(existing, {
      ...params, planId: 'different-plan'
    })).toThrow(/already has a proposed DAG/)
  })

  it('blocks unfinished acceptance criteria and already-completed work', () => {
    for (const [storyId, message] of [
      ['PH-102', /acceptance criteria/],
      ['PH-103', /already in progress/],
      ['missing', /missing/]
    ] as const) {
      expect(() => buildHubBacklogDagTemplate(doc, { ...params, storyId }))
        .toThrow(message)
    }
  })

  it('rejects invalid roles, IDs and timestamps', () => {
    expect(() => buildHubBacklogDagTemplate(doc, {
      ...params, implementationRole: 'atlas' as 'forge'
    })).toThrow(/Invalid deterministic/)
    expect(() => buildHubBacklogDagTemplate(doc, {
      ...params, planId: '../escape'
    })).toThrow(/Invalid deterministic/)
    expect(() => buildHubBacklogDagTemplate(doc, {
      ...params, createdAt: 'yesterday'
    })).toThrow(/Invalid deterministic/)
  })

  it('refuses append-only plan table overflow', () => {
    const proposal = buildHubBacklogDagTemplate(doc, params)
    const full = {
      ...doc, intelligence: {
        ...doc.intelligence, plans: Array.from({ length: 30 }, (_, i) =>
          ({ ...proposal, id: `plan-${i}`, objective: `Other plan ${i}` }))
      }
    }
    expect(() => buildHubBacklogDagTemplate(full, params)).toThrow(/plan limit/)
  })
})
