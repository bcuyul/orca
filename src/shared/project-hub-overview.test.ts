import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence, type HubImplementationEvidence, type HubQualityReview } from './project-hub-intelligence'
import { projectHubOverview } from './project-hub-overview'

const at = (minute: number): string => '2026-11-04T10:' + String(minute).padStart(2, '0') + ':00Z'
const sha = (char: string): string => char.repeat(40)

function makeLab() {
  const doc = emptyProjectHub('repo:lab')
  doc.items = [{
    id: 'PH-001', title: 'Synchronize the approved backlog',
    type: 'story', status: 'ready', phase: 1,
    source: 'local', description: '', acceptance: 'Keep history linked and readable'
  }]
  const first: HubImplementationEvidence = {
    id: 'impl-v1', planId: 'plan-lab', taskId: 'forge-lab-01',
    executor: 'external-unverified', executorLabel: 'OpenCode CLI',
    baseSha: sha('a'), headSha: sha('b'), evidenceRef: 'Local diff v1',
    testSummary: 'Whitespace and README checks', createdAt: at(1)
  }
  const second: HubImplementationEvidence = {
    ...first, id: 'impl-v2', baseSha: first.headSha, headSha: sha('c'),
    previousImplementationId: first.id, evidenceRef: 'Local diff v2', createdAt: at(4)
  }
  const qa = (id: string, implementationId: string, verdict: HubQualityReview['verdict'],
    minute: number): HubQualityReview => ({
    id, planId: 'plan-lab', taskId: 'forge-lab-01', reviewer: 'human',
    reviewerLabel: 'Independent Claude QA', implementationId, verdict,
    evidenceRef: 'Inspected local diff and Git state',
    findings: 'Independent human-attested review; no CI', createdAt: at(minute)
  })
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-lab', objective: 'Validate a safe Atlas Forge QA flow',
      rationale: 'Two-step lab with independently reviewed README',
      source: 'human', createdAt: at(0),
      tasks: [
        { id: 'forge-lab-01', title: 'Document laboratory', role: 'forge',
          dependsOn: [], acceptance: 'Document goals and planned tests' },
        { id: 'qa-lab-01', title: 'Independently review README', role: 'qa',
          dependsOn: ['forge-lab-01'], acceptance: 'Inspect actual commit' }
      ]
    }],
    decisions: [{ id: 'accept-lab', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'accepted', justification: 'Approved manual lab only', createdAt: at(0) }],
    implementations: [first, second],
    reviews: [
      qa('qa-first', first.id, 'approved', 2),
      qa('qa-correction', first.id, 'changes-requested', 3),
      qa('qa-second', second.id, 'approved', 5)
    ]
  }
  return doc
}

describe('Project Hub read-only overview', () => {
  it('handles a legacy document with no intelligence or automatic evidence', () => {
    const overview = projectHubOverview(emptyProjectHub('repo:empty'))
    expect(overview.activePlan).toBeNull()
    expect(overview.plans).toEqual({ total: 0, accepted: 0 })
    expect(overview.implementations).toBe(0)
    expect(overview.historicalReviews).toBe(0)
    expect(overview.executionAuthorized).toBe(false)
    expect(overview.ciVerifiedByThisProjection).toBe(false)
  })

  it('shows the real laboratory history without conflating backlog and DAG tasks', () => {
    const doc = makeLab()
    const original = JSON.stringify(doc)
    const overview = projectHubOverview(doc)
    expect(overview.backlog).toMatchObject({ total: 1, ready: 1, done: 0, review: 0 })
    expect(overview.plans).toEqual({ total: 1, accepted: 1 })
    expect(overview.activePlan?.tasks).toHaveLength(2)
    expect(overview.implementations).toBe(2)
    expect(overview.historicalReviews).toBe(3)
    expect(overview.linkedReviews).toBe(3)
    expect(overview.activePlan?.qaAttested).toBe(1)
    expect(overview.activePlan?.tasks.find(t => t.id === 'forge-lab-01')?.implementation?.headSha)
      .toBe(sha('c'))
    expect(overview.activePlan?.tasks.find(t => t.id === 'qa-lab-01')?.stage).toBe('role_only')
    expect(overview.recentActivity[0]?.title).toBe('QA aprobó (declarado)')
    expect(overview.recentActivity.map(e => e.title)).toContain('QA solicita correcciones (declarado)')
    expect(JSON.stringify(doc)).toBe(original)
    expect(overview.executionAuthorized).toBe(false)
    expect(overview.ciVerifiedByThisProjection).toBe(false)
  })

  it('invalidates old QA readiness when a new external implementation is added', () => {
    const doc = makeLab()
    doc.intelligence!.reviews = doc.intelligence!.reviews.slice(0, 2)
    const overview = projectHubOverview(doc)
    expect(overview.historicalReviews).toBe(2)
    expect(overview.activePlan?.qaAttested).toBe(0)
    expect(overview.activePlan?.awaitingQa).toBe(1)
    expect(overview.activePlan?.tasks[0]?.stage).toBe('awaiting_qa')
  })

  it('retains original review history, using only the last review for a given commit', () => {
    const doc = makeLab()
    doc.intelligence!.implementations = doc.intelligence!.implementations!.slice(0, 1)
    doc.intelligence!.reviews = doc.intelligence!.reviews.slice(0, 2)
    const overview = projectHubOverview(doc)
    expect(overview.activePlan?.blocked).toBe(1)
    expect(overview.activePlan?.tasks[0]?.stage).toBe('changes_requested')
    expect(overview.historicalReviews).toBe(2)
  })

  it('keeps legacy manual review visible but never counts it as linked QA', () => {
    const doc = makeLab()
    doc.intelligence!.reviews.push({
      id: 'qa-legacy', planId: 'plan-lab', taskId: 'qa-lab-01',
      reviewer: 'human', verdict: 'inconclusive',
      findings: 'Legacy note; no report reviewed', evidenceRef: 'Manual note', createdAt: at(6)
    })
    const overview = projectHubOverview(doc)
    expect(overview.historicalReviews).toBe(4)
    expect(overview.linkedReviews).toBe(3)
    expect(overview.activePlan?.qaAttested).toBe(1)
    expect(overview.recentActivity[0]?.description).toContain('sin entrega vinculada')
  })
})
