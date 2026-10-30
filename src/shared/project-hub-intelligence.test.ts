import { describe, expect, it } from 'vitest'
import {
  approvedHubMemories, emptyHubIntelligence, isHubIntelligence,
  isHubIntelligenceTransition, isHubPlanProposal, type HubPlanProposal
} from './project-hub-intelligence'
import {
  parseAtlasPlanJson, renderAtlasPlanningPrompt, renderQaReviewPrompt
} from './project-hub-intelligence-prompts'
import { emptyProjectHub } from './project-hub-types'

const at = '2026-10-30T10:00:00Z'
const plan = (): HubPlanProposal => ({
  id: 'plan-a', objective: 'Implement safe worktree launch', rationale: 'Track state across restarts',
  source: 'atlas-proposal', createdAt: at,
  tasks: [
    { id:'design', title:'Design consistent workflow', role:'atlas', dependsOn:[], acceptance:'Document API contracts' },
    { id:'build', title:'Implement worktree launcher', role:'forge', dependsOn:['design'], acceptance:'Provide tested changes' },
    { id:'review', title:'Independently validate work', role:'qa', dependsOn:['build'], acceptance:'Review checks and diff' }
  ]
})

describe('Agent intelligence contracts', () => {
  it('accepts bounded DAGs, rejects unknown prerequisites and cycles', () => {
    const p = plan()
    expect(isHubPlanProposal(p)).toBe(true)
    expect(isHubPlanProposal({ ...p, tasks:p.tasks.map(t => t.id==='design' ?
      {...t,dependsOn:['review']} : t) })).toBe(false)
    expect(isHubPlanProposal({ ...p, tasks:p.tasks.map(t => t.id==='build' ?
      {...t,dependsOn:['absent']} : t) })).toBe(false)
    expect(isHubPlanProposal({ ...p, tasks:[p.tasks[0],p.tasks[0]] })).toBe(false)
    expect(isHubPlanProposal({ ...p, tasks:[] })).toBe(false)
  })

  it('links blockers to task and requires a blocked predecessor for revisions', () => {
    const initial = { ...emptyHubIntelligence(), plans:[plan()] }
    const blocker = { id:'block-1',planId:'plan-a',taskId:'build',
      observation:'Windows file lock remains open',recommendedAction:'Close test journal first',createdAt:at }
    const revision = { ...plan(),id:'plan-b',previousPlanId:'plan-a',blockerId:'block-1' }
    expect(isHubIntelligence(initial)).toBe(true)
    expect(isHubIntelligence({ ...initial, plans:[plan(),revision] })).toBe(false)
    expect(isHubIntelligence({ ...initial,blockers:[blocker],plans:[plan(),revision] })).toBe(true)
    expect(isHubIntelligence({ ...initial,blockers:[{...blocker,taskId:'not-a-task'}] })).toBe(false)
    expect(isHubIntelligence({ ...initial,blockers:[blocker],plans:[plan(),{...revision,blockerId:'unknown'}] })).toBe(false)
  })

  it('requires explicit approval to use a candidate memory and preserves prior events', () => {
    const memory = { id:'memo-1',lesson:'Close journal before removing SQLite files on Windows',
      applicability:'Electron tests using WAL mode',evidenceRef:'agent-launch-replay.test.ts',
      createdAt:at }
    const initial = {...emptyHubIntelligence(),memories:[memory]}
    expect(isHubIntelligence(initial)).toBe(true)
    expect(approvedHubMemories(initial)).toEqual([])
    const accepted = {...initial,decisions:[{id:'decision-a',subject:'memory' as const,
      subjectId:'memo-1',verdict:'accepted' as const,justification:'Validated by unit tests',createdAt:at}]}
    expect(isHubIntelligence(accepted)).toBe(true)
    expect(approvedHubMemories(accepted)).toEqual([memory])
    expect(isHubIntelligenceTransition(initial, accepted)).toBe(true)
    expect(isHubIntelligenceTransition(accepted, initial)).toBe(false)
    expect(isHubIntelligenceTransition(accepted,{...accepted,memories:[{...memory,lesson:'Changed history'}]})).toBe(false)
    expect(isHubIntelligence({...accepted, decisions:[...accepted.decisions,{...accepted.decisions[0],id:'decision-b'}]})).toBe(false)
  })

  it('requires QA target evidence but never confuses a review declaration with CI', () => {
    const initial = { ...emptyHubIntelligence(), plans:[plan()] }
    const qa = { id:'review-1',planId:'plan-a',taskId:'review',reviewer:'human',
      verdict:'inconclusive',evidenceRef:'CI not yet available',
      findings:'No independent diff was provided',createdAt:at }
    expect(isHubIntelligence({...initial,reviews:[qa]})).toBe(true)
    expect(isHubIntelligence({...initial,reviews:[{...qa,taskId:'unknown'}]})).toBe(false)
    expect(isHubIntelligence({...initial,reviews:[{...qa,evidenceRef:''}]})).toBe(false)
  })

  it('renders safe Atlas/QA prompts and parses only valid JSON proposals', () => {
    const doc = emptyProjectHub('repo:test')
    doc.blueprint.idea = 'Implement supervised multi-agent planning'
    const prompt = renderAtlasPlanningPrompt(doc)
    expect(prompt).toContain('Output ONLY a JSON object')
    expect(prompt).toContain('Human approval')
    expect(prompt).toContain('# SOUL.md — Atlas')
    const p = plan()
    const parsed = parseAtlasPlanJson(JSON.stringify({
      objective:p.objective,rationale:p.rationale,tasks:p.tasks
    }),{id:'plan-c',createdAt:at})
    expect(parsed.tasks).toHaveLength(3)
    expect(() => parseAtlasPlanJson('{"objective":"short","tasks":[]}',{id:'plan-b',createdAt:at})).toThrow()
    expect(renderQaReviewPrompt(doc,p,'review','commit SHA example')).toContain('independent review')
    expect(() => renderQaReviewPrompt(doc,p,'unknown','commit')).toThrow()
  })
})
