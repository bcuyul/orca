import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { emptyProjectHub, isHubDocument } from '../../shared/project-hub-types'
import { prepareHubDelegation } from '../../shared/project-hub-delegation'

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
    // The shared validator correctly rejects a jump with a missing audit trail first.
    expect(()=>store.save(projectId,{...initial,phase:3},1)).toThrow(/Invalid Project Hub document/)
    // A syntactically valid phase-3 document must still be rejected by the
    // state transition guard when the persisted project is only at phase 1.
    const at=new Date().toISOString()
    const approval={from:1,to:2,note:'Revisión humana',at}
    const approvals=[approval,{from:2,to:3,note:'Segunda validación',at}]
    const phaseEvidence=Object.fromEntries([1,2].flatMap(phase=>
      ['acceptance','flow','ci','owner'].map(key=>[
        `${phase}:${key}`,{status:'verified' as const,note:'Evidencia revisada',at}
      ])
    ))
    const skipped={...initial,phase:3,approvals,qualityEvidence:phaseEvidence}
    expect(isHubDocument(skipped)).toBe(true)
    expect(()=>store.save(projectId,skipped,1)).toThrow(/Phase cannot skip/)
    expect(store.read(projectId).revision).toBe(1)
    expect(()=>store.save(projectId,{...initial,phase:2,approvals:[approval]},1)).toThrow(/evidence/)
    const qualityEvidence=Object.fromEntries(['acceptance','flow','ci','owner'].map(key=>[
      `1:${key}`,{status:'verified' as const,note:'Evidencia revisada',at:new Date().toISOString()}
    ]))
    const next=store.save(projectId,{...initial,phase:2,approvals:[approval],qualityEvidence},1)
    expect(next.phase).toBe(2)
    expect(()=>store.save(projectId,{...next,approvals:[]},2)).toThrow()
    expect(()=>store.save(projectId,{...next,qualityEvidence:{}},2)).toThrow(/evidence/)
  })
  it('rejects inconsistent QA notes before writing and preserves the existing revision',()=>{
    const store=new ProjectHubStore(root)
    const projectId='repo:qa-notes'
    const initial=store.save(projectId,emptyProjectHub(projectId),0)
    const at=new Date().toISOString()
    const template={status:'verified' as const,note:'checked',at}
    const notes=Object.fromEntries(['acceptance','flow','ci','owner'].map(key=>[`1:${key}`,template]))
    expect(()=>store.save(projectId,{...initial,qualityEvidence:{
      ...notes,'1:ci':{...template,note:'ok'}
    }},1)).toThrow(/Invalid/)
    expect(store.read(projectId).revision).toBe(1)
    const valid=store.save(projectId,{...initial,qualityEvidence:notes},1)
    expect(valid.revision).toBe(2)
    expect(()=>store.save(projectId,{...valid,phase:2,approvals:[
      {from:1,to:2,note:'no',at}
    ]},2)).toThrow(/Invalid/)
    expect(store.read(projectId).phase).toBe(1)
  })
  it('persists planned CLI delegations but refuses forged launch evidence',()=>{
    const db=new ProjectHubStore(root)
    const projectId='project:cli'
    const empty=emptyProjectHub(projectId)
    empty.items=[{id:'PH-001',title:'Isolated worktree',type:'story',status:'ready',phase:1,
      source:'local',acceptance:'Separate CLI worker',description:''}]
    const initial=db.save(projectId,empty,0)
    const planned=prepareHubDelegation({document:initial,storyIds:['PH-001'],
      agent:'opencode',reviewer:'codex',baseBranch:'main',repoId:'repoA',hostId:'local',now:new Date().toISOString(),
      mint:()=>({id:`hub-${'1'.repeat(32)}`,operationId:`1793290000000-${'1'.repeat(32)}`})})
    expect(()=>db.save(projectId,{...planned,delegations:planned.delegations?.map(row=>({
      ...row,status:'launched' as const,worktreeId:'wt1',terminalHandle:'term1'
    }))},1)).toThrow(/Delegation history/)
    const saved=db.save(projectId,planned,1)
    expect(db.read(projectId).delegations?.[0].status).toBe('planned')
    const row=saved.delegations![0]
    expect(()=>db.save(projectId,{...saved,delegations:[]},2)).toThrow(/Delegation history/)
    expect(()=>db.save(projectId,{...saved,delegations:[{
      ...row,status:'launched',worktreeId:'wt1',terminalHandle:'term1'
    }]},2)).toThrow(/Delegation history/)
    // A renderer can author planned intentions, but never forge host launch facts.
    expect(()=>db.save(projectId,{...saved,delegations:[{
      ...row,status:'launching'
    }]},2)).toThrow(/host-verified evidence/)
    expect(()=>db.save(projectId,{...saved,delegations:[{
      ...row,status:'launching',worktreeId:'fake-worktree'
    }]},2)).toThrow(/host-verified evidence/)
    expect(db.read(projectId).delegations?.[0].status).toBe('planned')
    expect(db.read(projectId).revision).toBe(2)

    // Legacy launch evidence remains readable and immutable; the renderer must
    // not be able to alter an already-persisted CLI status or worktree identity.
    const historic={...row,status:'launched' as const,worktreeId:'old-wt',terminalHandle:'old-pty'}
    const historicalPath=hubFilePath(root,projectId)
    writeFileSync(historicalPath,JSON.stringify({...saved,delegations:[historic]}),'utf8')
    const old=db.read(projectId)
    expect(old.delegations?.[0].status).toBe('launched')
    expect(()=>db.save(projectId,{...old,delegations:[{
      ...historic,worktreeId:'forged-wt'
    }]},old.revision)).toThrow(/Delegation history|host-verified evidence/)
    const kept=db.save(projectId,old,old.revision)
    expect(kept.delegations?.[0].worktreeId).toBe('old-wt')
  })
  it('persists intelligence proposals without allowing old evidence to be rewritten',()=>{
    const db=new ProjectHubStore(root)
    const id='repo:intelligence'
    const current=db.save(id,emptyProjectHub(id),0)
    const plan={id:'plan-a',objective:'Develop isolated orca workers',
      rationale:'Need consistent host ownership',source:'human' as const,
      tasks:[{id:'worker-a',title:'Develop launch contract',role:'forge' as const,
        dependsOn:[],acceptance:'Typecheck and replay tests pass'}],
      createdAt:new Date().toISOString()}
    const withPlan=db.save(id,{...current,intelligence:{
      plans:[plan],blockers:[],memories:[],reviews:[],decisions:[]
    }},1)
    expect(withPlan.intelligence?.plans).toHaveLength(1)
    expect(()=>db.save(id,{...withPlan,intelligence:undefined},2)).toThrow(/append-only/)
    expect(()=>db.save(id,{...withPlan,intelligence:{
      ...withPlan.intelligence!,plans:[{...plan,rationale:'Rewritten evidence'}]
    }},2)).toThrow(/append-only/)
    const after=db.read(id)
    expect(after.revision).toBe(2)
    expect(after.intelligence?.plans[0].rationale).toBe(plan.rationale)
  })
  it('stores story-task associations as immutable append-only audit events', () => {
    const db = new ProjectHubStore(root)
    const id = 'repo:story-task-audit'
    const doc = emptyProjectHub(id)
    doc.items = [{ id: 'PH-001', title: 'Atlas traceability',
      type: 'story', status: 'ready', phase: 1,
      source: 'local', acceptance: 'Trace the task without status inference', description: '' }]
    doc.intelligence = {
      plans: [{ id: 'plan-lab', objective: 'Link story to reviewed DAG',
        rationale: 'Explicit human-reviewed association',
        source: 'human', createdAt: new Date().toISOString(),
        tasks: [{ id: 'forge-lab', title: 'Create README proof',
          role: 'forge', dependsOn: [], acceptance: 'Evidence is inspected' }] }],
      blockers: [], memories: [], reviews: [],
      decisions: [{ id: 'decision-lab', subject: 'plan', subjectId: 'plan-lab',
        verdict: 'accepted', justification: 'Human accepted the DAG',
        createdAt: new Date().toISOString() }]
    }
    const saved = db.save(id, doc, 0)
    const event = { id: 'link-first', planId: 'plan-lab', taskId: 'forge-lab',
      storyId: 'PH-001', at: new Date().toISOString() }
    const linked = db.save(id, { ...saved, taskLinks: [event] }, 1)
    expect(db.read(id).taskLinks).toEqual([event])
    expect(db.read(id).items[0]?.status).toBe('ready')
    expect(() => db.save(id, { ...linked, taskLinks: [] }, 2)).toThrow(/append-only/)
    expect(() => db.save(id, { ...linked,
      taskLinks: [{ ...event, at: '2026-11-01T00:00:00Z' }] }, 2)).toThrow(/append-only/)
    expect(db.read(id).revision).toBe(2)
    const corrected = db.save(id, { ...linked,
      taskLinks: [...linked.taskLinks!, { ...event, id: 'link-unlink', storyId: null }] }, 2)
    expect(corrected.taskLinks).toHaveLength(2)
    expect(corrected.items[0]?.status).toBe('ready')
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
