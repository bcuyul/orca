import { describe, expect, it } from 'vitest'
import { emptyProjectHub, approveHubPhase, isHubDocument, PROJECT_HUB_PHASES } from './project-hub-types'
describe('Project Hub document contracts',()=>{
  it('has all ten phases',()=>expect(PROJECT_HUB_PHASES).toHaveLength(10))
  it('starts as a valid isolated project document',()=>{
    const doc=emptyProjectHub('github:bcuyul/orca')
    expect(isHubDocument(doc)).toBe(true)
    expect(doc.projectId).toBe('github:bcuyul/orca')
    expect(doc.phase).toBe(1)
  })
  it('requires approval and keeps the previous document intact',()=>{
    const doc=emptyProjectHub('repo:123')
    expect(()=>approveHubPhase(doc,'',new Date().toISOString())).toThrow()
    const next=approveHubPhase(doc,'Validación humana',new Date().toISOString())
    expect(next.phase).toBe(2)
    expect(doc.phase).toBe(1)
    expect(isHubDocument(next)).toBe(true)
  })
  it('rejects duplicate items, invalid phases, invalid architecture edges',()=>{
    const doc=emptyProjectHub('repo:123')
    expect(isHubDocument({...doc,phase:11})).toBe(false)
    expect(isHubDocument({...doc,architecture:{notes:'',nodes:[],edges:[{from:'A',to:'B'}]}})).toBe(false)
  })
})
