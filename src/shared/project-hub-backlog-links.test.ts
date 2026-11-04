import { describe, expect, it } from 'vitest'
import { emptyProjectHub, isHubDocument } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import {
  isHubTaskLinkHistory, isHubTaskLinkTransition, projectHubBacklogLinks,
  projectHubStoryEvidence,
  type HubTaskLinkEvent
} from './project-hub-backlog-links'

const at = '2026-11-04T12:00:00Z'
function scenario() {
  const doc = emptyProjectHub('project:lab')
  doc.items = [{ id: 'PH-001', type: 'story', title: 'Trace approved work',
    status: 'ready', phase: 1, source: 'local', acceptance: 'Review trace',
    description: '' }]
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{ id: 'plan-lab', objective: 'Trace Atlas Forge QA by story',
      rationale: 'Audit the lab without automatic status updates',
      source: 'human', createdAt: at,
      tasks: [
        { id: 'forge-lab', title: 'Write laboratory README',
          role: 'forge', dependsOn: [], acceptance: 'README has checked evidence' },
        { id: 'qa-lab', title: 'Inspect the diff independently',
          role: 'qa', dependsOn: ['forge-lab'], acceptance: 'Review actual diff' }
      ] }],
    decisions: [{ id: 'decision-lab', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'accepted', justification: 'Reviewed the laboratory DAG', createdAt: at }]
  }
  return doc
}
const link = (id: string, taskId: string, storyId: string | null): HubTaskLinkEvent => ({
  id, taskId, storyId, planId: 'plan-lab', at
})

describe('Project Hub explicit backlog-DAG linkage', () => {
  it('preserves legacy documents and never implies execution or automatic status', () => {
    const blank = emptyProjectHub('project:legacy')
    expect(isHubDocument(blank)).toBe(true)
    expect(projectHubBacklogLinks(blank)).toMatchObject({
      approvedPlanId: null, tasks: [], executionAuthorized: false, autoStatusSync: false
    })
    const doc = scenario()
    const output = projectHubBacklogLinks(doc)
    expect(output.unlinkedTaskCount).toBe(2)
    expect(output.tasks.map(task => task.storyId)).toEqual([null, null])
    expect(doc.items[0]?.status).toBe('ready')
  })

  it('links two Atlas DAG tasks to one story without updating backlog state', () => {
    const doc = scenario()
    const snapshot = JSON.stringify(doc)
    doc.taskLinks = [link('link-forge', 'forge-lab', 'PH-001'),
      link('link-qa', 'qa-lab', 'PH-001')]
    expect(isHubDocument(doc)).toBe(true)
    const mapped = projectHubBacklogLinks(doc)
    expect(mapped.tasks.map(task => task.storyId)).toEqual(['PH-001', 'PH-001'])
    expect(mapped.unlinkedTaskCount).toBe(0)
    expect(mapped.tasks[1]?.stage).toBe('role_only')
    expect(doc.items[0]?.status).toBe('ready')
    expect(mapped.executionAuthorized).toBe(false)
    expect(JSON.stringify(scenario())).toBe(snapshot)
  })

  it('aggregates evidence without changing a manually Ready story or confusing QA plans with execution', () => {
    const doc = scenario()
    doc.taskLinks = [link('link-forge', 'forge-lab', 'PH-001'),
      link('link-qa', 'qa-lab', 'PH-001')]
    const original = JSON.stringify(doc)
    const pending = projectHubStoryEvidence(doc)
    expect(pending.stories[0]).toMatchObject({
      backlogStatus: 'ready', linkedTaskCount: 2,
      plannedOrUnverifiedCount: 2, awaitingQaCount: 0,
      qaApprovedDeclaredCount: 0, blockedOrCorrectionsCount: 0
    })
    expect(JSON.stringify(doc)).toBe(original)

    const implementation = {
      id: 'impl-v1', planId: 'plan-lab', taskId: 'forge-lab',
      executor: 'external-unverified' as const, executorLabel: 'Forge CLI',
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      evidenceRef: 'Declared Git diff, not verified',
      testSummary: 'Declared tests only', createdAt: at
    }
    doc.intelligence!.implementations = [implementation]
    expect(projectHubStoryEvidence(doc).stories[0]).toMatchObject({
      plannedOrUnverifiedCount: 1, awaitingQaCount: 1, qaApprovedDeclaredCount: 0
    })
    doc.intelligence!.reviews.push({
      id: 'review-v1', planId: 'plan-lab', taskId: 'forge-lab',
      reviewer: 'qa', verdict: 'approved', implementationId: 'impl-v1',
      reviewerLabel: 'Independent QA',
      evidenceRef: 'Manual diff review, unverified',
      findings: 'Declared approval only, no verified host receipt',
      createdAt: at
    })
    expect(projectHubStoryEvidence(doc).stories[0]).toMatchObject({
      backlogStatus: 'ready', linkedTaskCount: 2,
      plannedOrUnverifiedCount: 1, qaApprovedDeclaredCount: 1, awaitingQaCount: 0
    })

    doc.intelligence!.implementations.push({
      ...implementation, id: 'impl-v2', baseSha: 'b'.repeat(40),
      headSha: 'c'.repeat(40), previousImplementationId: 'impl-v1'
    })
    expect(projectHubStoryEvidence(doc).stories[0]).toMatchObject({
      qaApprovedDeclaredCount: 0, awaitingQaCount: 1
    })
    expect(doc.items[0]?.status).toBe('ready')
    expect(projectHubStoryEvidence(doc).autoStatusSync).toBe(false)
    expect(projectHubStoryEvidence(doc).executionAuthorized).toBe(false)
  })

  it('never mixes another story or an old plan into the current story summary', () => {
    const doc = scenario()
    doc.items.push({ ...doc.items[0]!, id: 'PH-002', title: 'Separate story' })
    doc.taskLinks = [
      link('link-first', 'forge-lab', 'PH-001'),
      link('link-reassign', 'forge-lab', 'PH-002')
    ]
    const output = projectHubStoryEvidence(doc)
    expect(output.stories.find(row => row.storyId === 'PH-001')?.linkedTaskCount).toBe(0)
    expect(output.stories.find(row => row.storyId === 'PH-002')?.linkedTaskCount).toBe(1)
    expect(output.unlinkedTaskCount).toBe(1)
  })

  it('supports audited correction and unlink without rewriting old evidence', () => {
    const doc = scenario()
    doc.items.push({ ...doc.items[0]!, id: 'PH-002', title: 'Second story' })
    doc.taskLinks = [link('link-first', 'forge-lab', 'PH-001'),
      link('link-reassign', 'forge-lab', 'PH-002'),
      link('link-unlink', 'forge-lab', null)]
    expect(isHubTaskLinkHistory(doc)).toBe(true)
    expect(projectHubBacklogLinks(doc).unlinkedTaskCount).toBe(2)
    const previous = doc.taskLinks.slice(0, 2)
    expect(isHubTaskLinkTransition(previous, doc.taskLinks)).toBe(true)
    expect(isHubTaskLinkTransition(doc.taskLinks, previous)).toBe(false)
    expect(isHubTaskLinkTransition(previous, [
      { ...previous[0]!, storyId: 'PH-002' }, previous[1]!
    ])).toBe(false)
  })

  it('rejects foreign stories, unknown plans/tasks, duplicate IDs and invented unlink', () => {
    const doc = scenario()
    for (const forged of [
      link('link-a', 'forge-lab', 'PH-999'),
      { ...link('link-a', 'forge-lab', 'PH-001'), planId: 'plan-foreign' },
      link('link-a', 'task-foreign', 'PH-001'),
      { ...link('link-a', 'forge-lab', 'PH-001'), at: 'not-a-time' },
      link('link-a', 'forge-lab', null)
    ]) {
      doc.taskLinks = [forged]
      expect(isHubDocument(doc)).toBe(false)
    }
    for (const malformed of [
      { ...link('valid-id', 'forge-lab', 'PH-001'), id: 42 },
      { ...link('valid-id', 'forge-lab', 'PH-001'), planId: 42 },
      { ...link('valid-id', 'forge-lab', 'PH-001'), taskId: 42 }
    ]) {
      expect(isHubDocument({ ...doc, taskLinks: [malformed] })).toBe(false)
    }
    doc.taskLinks = [link('same-id', 'forge-lab', 'PH-001'),
      link('same-id', 'qa-lab', 'PH-001')]
    expect(isHubDocument(doc)).toBe(false)
    doc.taskLinks = [link('link-first', 'forge-lab', 'PH-001'),
      link('link-repeat', 'forge-lab', 'PH-001')]
    expect(isHubDocument(doc)).toBe(false)
  })

  it('fails closed for rejected plans and too many audit records', () => {
    const doc = scenario()
    doc.intelligence!.decisions[0]!.verdict = 'rejected'
    doc.taskLinks = [link('link-first', 'forge-lab', 'PH-001')]
    expect(isHubDocument(doc)).toBe(false)
    doc.intelligence!.decisions[0]!.verdict = 'accepted'
    doc.taskLinks = Array.from({ length: 101 }, (_, i) =>
      ({ ...link(`link-${i}`, 'forge-lab', 'PH-001') }))
    expect(isHubDocument(doc)).toBe(false)
  })
})
