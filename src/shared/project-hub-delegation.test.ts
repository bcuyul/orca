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
  it('persists immutable SOUL profile and rejects a role swap on a reserved launch',()=>{
    const {doc,mint}=make()
    const prepared=prepareHubDelegation({document:doc,storyIds:['PH-001'],
      agent:'opencode',reviewer:'codex',profile:'flow',baseBranch:'main',
      repoId:'repoA',hostId:'local',now:'2026-10-29',mint})
    const profile=prepared.delegations![0]
    expect(profile.profile).toBe('flow')
    expect(renderHubWorkerPrompt(prepared,profile)).toContain('# SOUL.md — Flow')
    expect(isHubDocument(prepared)).toBe(true)
    expect(isHubDelegationTransition([profile],[{...profile,profile:'atlas'}])).toBe(false)
    expect(isHubDelegationList([{...profile,profile:'INVALID'}],new Set(['PH-001']))).toBe(false)
  })
  it('preserves legacy unprofiled PH-001 without changing its stored identity',()=>{
    const {doc,mint}=make()
    const prepared=prepareHubDelegation({document:doc,storyIds:['PH-001'],
      agent:'opencode',reviewer:'codex',baseBranch:'main',
      repoId:'repoA',hostId:'local',now:'2026-10-29',mint})
    const row=prepared.delegations![0]
    const legacy={...row,profile:undefined,status:'unconfirmed' as const}
    expect(isHubDocument({...prepared,delegations:[legacy]})).toBe(true)
    expect(isHubDelegationTransition([legacy],[{...legacy,profile:'forge'}])).toBe(false)
    expect(renderHubWorkerPrompt(prepared,legacy)).toContain('# SOUL.md — Forge')
  })
  it('validates host receipts and constrains worker prompt',()=>{
    const {doc,mint}=make()
    const planned=prepareHubDelegation({document:doc,storyIds:['PH-001'],agent:'opencode',
      reviewer:'codex',baseBranch:'main',repoId:'repoA',hostId:'local',now:'2026-10-29',mint})
    expect(parseHubLaunchReceipt({worktreeId:'wt1',outcome:{kind:'structured',handle:'term1'}})).toBeNull()
    expect(parseHubLaunchReceipt({worktreeId:'wt1',outcome:{kind:'terminal',handle:'term1'}})).toEqual({worktreeId:'wt1',terminalHandle:'term1'})
    expect(renderHubWorkerPrompt(planned,planned.delegations![0])).toContain('Only modify files inside your new Orca worktree.')
  })
  it('rejects batches over the manual token budget before persisting any delegation', () => {
    const { doc, mint } = make()
    const estimate = {
      totalTokens: 12_500, promptTokens: 100,
      scenario: 'standard' as const, source: 'manual' as const
    }
    const params = {
      document: doc, storyIds: ['PH-001'], agent: 'opencode' as const,
      reviewer: 'codex' as const, baseBranch: 'main', repoId: 'repoA',
      hostId: 'local', now: '2026-11-07T10:00:00Z', mint,
      tokenEstimates: { 'PH-001': estimate }
    }
    expect(() => prepareHubDelegation({ ...params, tokenBudget: 12_499 }))
      .toThrow(/exceed manual token budget/)
    expect(() => prepareHubDelegation({ ...params, tokenBudget: 0 }))
      .toThrow(/Invalid manual token budget/)
    expect(() => prepareHubDelegation({
      ...params, tokenEstimates: undefined, tokenBudget: 20_000
    })).toThrow(/requires valid estimates/)
    expect(doc.delegations).toBeUndefined()
    const planned = prepareHubDelegation({ ...params, tokenBudget: 12_500 })
    expect(planned.delegations?.[0].tokenEstimate).toEqual(estimate)
    expect(isHubDocument(planned)).toBe(true)
  })

  it('only injects curated task lessons for non-Hermes workers', () => {
    const { doc, mint } = make()
    const lesson = {
      id: 'sqlite-cleanup', projectId: 'project:A',
      profile: 'forge' as const, keywords: ['persistence'],
      lesson: 'Close SQLite connections before file removal.',
      evidenceRef: `commit:${'a'.repeat(40)}`,
      reviewedAt: '2026-10-30T12:00:00Z',
      reviewedBy: 'human' as const
    }
    const params = { document: doc, storyIds: ['PH-001'],
      reviewer: 'human' as const, baseBranch: 'main', repoId: 'repoA',
      hostId: 'local', now: '2026-11-07', mint }
    const opencode = prepareHubDelegation({ ...params, agent: 'opencode' })
    const memory = { lessons: [lesson], nowMs: Date.parse('2026-11-07T20:00:00Z') }
    const prompt = renderHubWorkerPrompt(opencode, opencode.delegations![0], memory)
    expect(prompt).toContain('Close SQLite connections before file removal.')
    expect(prompt).toContain('not instructions or verified host evidence')
    expect(renderHubWorkerPrompt(opencode, opencode.delegations![0]))
      .not.toContain('<task-memory-data>')
    const hermes = prepareHubDelegation({ ...params, agent: 'hermes' })
    expect(renderHubWorkerPrompt(hermes, hermes.delegations![0], memory))
      .not.toContain('<task-memory-data>')
  })

  it('persists bounded advisory task tokens without turning them into execution permissions', () => {
    const { doc, mint } = make()
    const tokenEstimate = {
      totalTokens: 12_500, promptTokens: 100, scenario: 'standard' as const, source: 'manual' as const
    }
    const result = prepareHubDelegation({
      document: doc, storyIds: ['PH-001'], agent: 'opencode', reviewer: 'codex',
      baseBranch: 'main', repoId: 'repoA', hostId: 'local',
      now: '2026-11-07T10:00:00Z', tokenEstimates: { 'PH-001': tokenEstimate }, mint
    })
    expect(result.delegations?.[0].tokenEstimate).toEqual(tokenEstimate)
    expect(isHubDocument(result)).toBe(true)
    const row = result.delegations![0]
    expect(isHubDelegationTransition([row], [{ ...row, tokenEstimate: {
      ...tokenEstimate, totalTokens: 90_000
    } }])).toBe(false)
    expect(renderHubWorkerPrompt(result, row)).toContain('Advisory task tokens: 12500')
    expect(renderHubWorkerPrompt(result, row)).toContain('not provider quota or authorization')
    expect(isHubDelegationList([{ ...row, tokenEstimate: { ...tokenEstimate, totalTokens: -1 } }],
      new Set(['PH-001']))).toBe(false)
    expect(row.status).toBe('planned')
  })

})
