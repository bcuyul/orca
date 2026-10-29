import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { emptyProjectHub } from '../../shared/project-hub-types'

// A test-only writer avoids depending on Windows ACL addons in isolated unit tests.
vi.mock('../../shared/secure-file',()=>({
  writeSecureFile:(path:string,content:string)=>{
    mkdirSync(dirname(path),{recursive:true})
    writeFileSync(path,content,'utf8')
    return true
  }
}))
import { hubFilePath, ProjectHubStore } from './project-hub-store'

let root:string
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'project-hub-'))})
afterEach(()=>{rmSync(root,{force:true,recursive:true})})
describe('ProjectHubStore',()=>{
  it('isolates projects without putting paths or ids in filenames',()=>{
    const store=new ProjectHubStore(root)
    const a=emptyProjectHub('github:org/a')
    const b=emptyProjectHub('github:org/b')
    store.save(a.projectId,a,0)
    expect(store.read(a.projectId).revision).toBe(1)
    expect(store.read(b.projectId).revision).toBe(0)
    expect(hubFilePath(root,a.projectId)).not.toContain('github:')
  })
  it('rejects stale writes and cannot cross another project',()=>{
    const store=new ProjectHubStore(root)
    const a=emptyProjectHub('repo:one')
    store.save(a.projectId,a,0)
    expect(()=>store.save(a.projectId,a,0)).toThrow(/Conflict/)
    expect(()=>store.save('repo:two',a,0)).toThrow(/Invalid/)
  })
  it('rejects skipped phases and requires append-only approvals with recorded QA evidence',()=>{
    const store=new ProjectHubStore(root)
    const projectId='repo:stage'
    const initial=store.save(projectId,emptyProjectHub(projectId),0)
    expect(()=>store.save(projectId,{...initial,phase:3},1)).toThrow(/Phase/)
    const approval={from:1,to:2,note:'Revisión humana',at:new Date().toISOString()}
    expect(()=>store.save(projectId,{...initial,phase:2,approvals:[approval]},1)).toThrow(/evidence/)
    const qualityEvidence=Object.fromEntries(['acceptance','flow','ci','owner'].map(key=>[
      '1:'+key,{status:'verified' as const,note:'Evidencia revisada',at:new Date().toISOString()}
    ]))
    const next=store.save(projectId,{...initial,phase:2,approvals:[approval],qualityEvidence},1)
    expect(next.phase).toBe(2)
    expect(()=>store.save(projectId,{...next,approvals:[]},2)).toThrow()
    expect(()=>store.save(projectId,{...next,qualityEvidence:{}},2)).toThrow(/evidence/)
  })
  it('fails closed if existing JSON is corrupted',()=>{
    const store=new ProjectHubStore(root)
    const path=hubFilePath(root,'repo:one')
    mkdirSync(dirname(path),{recursive:true})
    writeFileSync(path,'{not json','utf8')
    expect(()=>store.read('repo:one')).toThrow()
    expect(()=>store.save('repo:one',emptyProjectHub('repo:one'),0)).toThrow()
    expect(readFileSync(path,'utf8')).toBe('{not json')
  })
})
