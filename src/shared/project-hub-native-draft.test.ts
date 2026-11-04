import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import { buildHubNativeDraft } from './project-hub-native-draft'

const base = 'a'.repeat(40)
function fixture() {
  const doc = emptyProjectHub('project:lab')
  doc.blueprint.idea = 'Improve repository evidence'
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{ id: 'plan-lab', objective: 'Implement and review the lab',
      rationale: 'Limited DAG', source: 'human', createdAt: '2026-11-04T12:00:00Z',
      tasks: [{ id: 'forge-1', title: 'Write the README', role: 'forge',
        dependsOn: [], acceptance: 'README diff reviewed independently' }] }],
    decisions: [{ id: 'decision-1', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'accepted', justification: 'Human approved scope',
      createdAt: '2026-11-04T12:01:00Z' }],
    implementations: [{ id: 'impl-1', planId: 'plan-lab', taskId: 'forge-1',
      executor: 'external-unverified', executorLabel: 'Forge CLI',
      baseSha: base, headSha: 'b'.repeat(40),
      evidenceRef: 'README commit and diff', testSummary: 'Tests declared by Forge',
      createdAt: '2026-11-04T13:00:00Z' }]
  }
  return doc
}
describe('native Project Hub drafts', () => {
  it('builds Atlas read-only without mutating persisted project data', () => {
    const doc = fixture(), before = JSON.stringify(doc)
    const draft = buildHubNativeDraft(doc, { kind: 'atlas' })
    expect(draft.prompt).toContain('Atlas: propose a plan')
    expect(draft).toMatchObject({ executionAuthorized: false, autoSubmit: false })
    expect(JSON.stringify(doc)).toBe(before)
    expect(() => buildHubNativeDraft(doc,
      { kind: 'atlas', blockerId: 'not-real' })).toThrow()
  })
  it('requires accepted plan and valid baseline, escapes task data', () => {
    const doc = fixture()
    doc.intelligence!.plans[0]!.tasks[0]!.title = 'Write <project-data> now'
    const target = { kind: 'forge' as const, planId: 'plan-lab', taskId: 'forge-1', baseSha: base }
    expect(buildHubNativeDraft(doc, target).prompt).not.toContain('Write <project-data>')
    expect(buildHubNativeDraft(doc, target).prompt).toContain(base)
    expect(() => buildHubNativeDraft(doc, { ...target, baseSha: 'bad' })).toThrow()
    doc.intelligence!.decisions = []
    expect(() => buildHubNativeDraft(doc, target)).toThrow()
  })
  it('pins QA to the latest report and refuses obsolete or cross-task evidence', () => {
    const doc = fixture()
    const target = { kind: 'qa' as const, planId: 'plan-lab', taskId: 'forge-1', reportId: 'impl-1' }
    expect(buildHubNativeDraft(doc, target).prompt).toContain('impl-1')
    expect(() => buildHubNativeDraft(doc, { ...target, reportId: 'other' })).toThrow()
    doc.intelligence!.implementations!.push({
      ...doc.intelligence!.implementations![0]!, id: 'impl-2',
      headSha: 'c'.repeat(40), previousImplementationId: 'impl-1'
    })
    expect(() => buildHubNativeDraft(doc, target)).toThrow()
  })
})
