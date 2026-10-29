import { describe,expect,it } from 'vitest'
import { emptyProjectHub, isHubDocument } from './project-hub-types'
import {
  prepareHubDelegation,isHubDelegationList,isHubDelegationTransition,
  renderHubWorkerPrompt,parseHubLaunchReceipt
} from './project-hub-delegation'

const make=()=>{
  const doc=emptyProjectHub('project:A')
  doc.items=[
    {id:'PH-001',title:'Test persistence',status:'ready',type:'story',phase:1,source:'local',acceptance:'Persistent after restart',description:''},
    {id:'PH-002',title:'Test isolation',status:'backlog',type:'story',phase:1,source:'local',acceptance:'Separate repositories',description:''}
  ]
  let n=0
  const mint=()=>{
    n++
    return {id:`hub-${n.toString(16).padStart(32,'0')}`,operationId:`1793290000000-${n.toString(16).padStart(32,'0')}`}
  }
  return {doc,mint}
}
describe('Hermes-inspired Project Hub CLI delegation',()=>{
  it('prepares two distinct CLI worktrees with replayable operation IDs',()=>{
    const {doc,mint}=make()
    const result=prepareHubDelegation({document:doc,storyIds:['PH-001','PH-002'],
      agent:'opencode',reviewer:'codex',baseBranch:'refs/heads/main',repoId:'repoA',hostId:'local',
      now:'2026-10-29T12:00:00Z',mint})
    expect(result.delegations).toHaveLength(2)
    expect(result.delegations?.[0].name).toBe('ph-ph-001-000001')
    expect(result.delegations?.[1].name).toBe('ph-ph-002-000002')
    expect(result.delegations?.[0].operationId).not.toBe(result.delegations?.[1].operationId)
    expect(result.delegations?.[0].baseBranch).toBe('main')
    expect(isHubDocument(result)).toBe(true)
    expect(doc.delegations).toBeUndefined()
  })
  it('rejects self-review, duplicate story, unknown story and repeat active plan',()=>{
    const {doc,mint}=make()
    const params={document:doc,storyIds:['PH-001'],agent:'opencode' as const,
      reviewer:'codex' as const,baseBranch:'main',repoId:'repoA',hostId:'local',now:'2026-10-29',mint}
    expect(()=>prepareHubDelegation({...params,reviewer:'opencode'})).toThrow()
    expect(()=>prepareHubDelegation({...params,storyIds:['PH-001','PH-001']})).toThrow()
    expect(()=>prepareHubDelegation({...params,storyIds:['PH-003']})).toThrow()
    const planned=prepareHubDelegation(params)
    expect(()=>prepareHubDelegation({...params,document:planned})).toThrow()
  })
  it('rejects mutation, skipped reservation or removal of launched agents',()=>{
    const {doc,mint}=make()
    const planned=prepareHubDelegation({document:doc,storyIds:['PH-001'],agent:'opencode',
      reviewer:'human',baseBranch:'main',repoId:'repoA',hostId:'local',now:'2026-10-29',mint}).delegations!
    expect(isHubDelegationTransition(planned,[])).toBe(false)
    expect(isHubDelegationTransition(planned,[{...planned[0],agent:'claude'}])).toBe(false)
    expect(isHubDelegationTransition(planned,[{...planned[0],repoId:'repoB'}])).toBe(false)
    expect(isHubDelegationTransition(planned,[{...planned[0],status:'launched',worktreeId:'wt1',terminalHandle:'term1'}])).toBe(false)
    const reserved=[{...planned[0],status:'launching' as const}]
    expect(isHubDelegationTransition(planned,reserved)).toBe(true)
    const launched=[{...reserved[0],status:'launched' as const,worktreeId:'wt1',terminalHandle:'term1'}]
    expect(isHubDelegationTransition(reserved,launched)).toBe(true)
    expect(isHubDelegationTransition(launched,[{...launched[0],worktreeId:'other'}])).toBe(false)
    expect(isHubDelegationList([planned[0],planned[0]],new Set(['PH-001']))).toBe(false)
    expect(isHubDelegationTransition([],launched)).toBe(false)
    expect(isHubDelegationList([{...planned[0],id:`hub-${'2'.repeat(32)}`},planned[0]],new Set(['PH-001']))).toBe(false)
  })
  it('validates host receipts and constrains worker prompt',()=>{
    const {doc,mint}=make()
    const planned=prepareHubDelegation({document:doc,storyIds:['PH-001'],agent:'opencode',
      reviewer:'codex',baseBranch:'main',repoId:'repoA',hostId:'local',now:'2026-10-29',mint})
    expect(parseHubLaunchReceipt({worktreeId:'wt1',outcome:{kind:'structured',handle:'term1'}})).toBeNull()
    expect(parseHubLaunchReceipt({worktreeId:'wt1',outcome:{kind:'terminal',handle:'term1'}})).toEqual({worktreeId:'wt1',terminalHandle:'term1'})
    expect(renderHubWorkerPrompt(planned,planned.delegations![0])).toContain('Only modify files inside your new Orca worktree.')
  })
})
