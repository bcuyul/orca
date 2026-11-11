import { describe, expect, it } from 'vitest'
import { emptyProjectHub, isHubDocument, type HubItem } from './project-hub-types'
import {
  preservesHubBacklogItemIdentities, setHubBacklogItemArchived
} from './project-hub-backlog-archive'
import { emptyHubIntelligence } from './project-hub-intelligence'
import { buildHubBacklogDagTemplate } from './project-hub-backlog-dag-template'

const item: HubItem = {
  id: 'PH-001', title: 'Crear incidencias', type: 'story',
  status: 'backlog', phase: 1, source: 'local',
  description: '', acceptance: 'Se puede registrar una incidencia'
}
function lab() {
  return {
    ...emptyProjectHub('repo:backlog-archive'),
    items: [item],
    intelligence: {
      ...emptyHubIntelligence(),
      plans: [{
        id: 'plan-archive', objective: 'PH-001: Crear incidencias',
        rationale: 'A reviewed example of an implementation and independent QA',
        source: 'human' as const, createdAt: '2026-11-11T12:00:00Z',
        tasks: [{
          id: 'implement', title: 'Implementar incidencias', role: 'forge' as const,
          acceptance: 'Registrar incidencia correctamente', dependsOn: []
        }]
      }]
    }
  }
}
describe('Project Hub reversible removal from backlog', () => {
  it('hides instead of deleting and preserves approved plan references and stable IDs', () => {
    const doc=lab()
    const archived=setHubBacklogItemArchived(doc,'PH-001',true)
    expect(archived.items).toHaveLength(1)
    expect(archived.items[0]?.archived).toBe(true)
    expect(archived.intelligence).toEqual(doc.intelligence)
    expect(archived.items[0]?.id).toBe('PH-001')
    expect(doc.items[0]?.archived).toBeUndefined()
    expect(isHubDocument(archived)).toBe(true)
    expect(preservesHubBacklogItemIdentities(doc.items,archived.items)).toBe(true)
    expect(preservesHubBacklogItemIdentities(doc.items,[])).toBe(false)
    const restored=setHubBacklogItemArchived(archived,'PH-001',false)
    expect(restored.items[0]?.archived).toBe(false)
    expect(isHubDocument(restored)).toBe(true)
  })
  it('does not make archived stories eligible for new model-free DAGs', () => {
    const archived=setHubBacklogItemArchived(lab(),'PH-001',true)
    expect(()=>buildHubBacklogDagTemplate(archived,{
      storyId:'PH-001',planId:'plan-new',createdAt:'2026-11-11T13:00:00Z',
      implementationRole:'forge'
    })).toThrow(/missing or already in progress/)
  })
  it('requires explicit changes and refuses archive of in-progress items', () => {
    expect(()=>setHubBacklogItemArchived(lab(),'missing',true))
      .toThrow(/No existe/)
    expect(()=>setHubBacklogItemArchived(lab(),'PH-001',false))
      .toThrow(/no está archivado/)
    const active={...lab(),items:[{...item,status:'doing' as const}]}
    expect(()=>setHubBacklogItemArchived(active,'PH-001',true))
      .toThrow(/Backlog o Ready/)
    const archived=setHubBacklogItemArchived(lab(),'PH-001',true)
    expect(()=>setHubBacklogItemArchived(archived,'PH-001',true))
      .toThrow(/ya fue quitado/)
  })
  it('rejects nonboolean archive fields at persisted schema boundary', () => {
    const doc=lab()
    expect(isHubDocument({...doc,items:[{...item,archived:'yes'}]})).toBe(false)
  })
})
