import { describe, expect, it } from 'vitest'
import { emptyProjectHub } from './project-hub-types'
import { emptyHubIntelligence } from './project-hub-intelligence'
import { previewNativeAgentRouting } from './project-hub-native-agent-routing'
import { TUI_AGENT_AUTO_PICK_ORDER } from './tui-agent-selection'

const lab = () => {
  const doc = emptyProjectHub('repo:lab')
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-lab', objective: 'Validate Atlas Forge and independent QA',
      rationale: 'Controlled worktree lab with two dependent tasks',
      source: 'human', createdAt: '2026-11-04T10:00:00Z',
      tasks: [
        { id: 'forge-lab-01', title: 'Document the test lab', role: 'forge',
          dependsOn: [], acceptance: 'README documents goals and tests' },
        { id: 'qa-lab-01', title: 'Review independently', role: 'qa',
          dependsOn: ['forge-lab-01'], acceptance: 'Inspect diff and tests' }
      ]
    }],
    decisions: [{
      id: 'decision-lab', subject: 'plan', subjectId: 'plan-lab',
      verdict: 'accepted', justification: 'Approved the manual lab plan',
      createdAt: '2026-11-04T10:01:00Z'
    }]
  }
  return doc
}

describe('Project Hub native agent routing preview', () => {
  it('keeps the real six agents and approved DAG but never admits a session', () => {
    const doc = lab()
    const original = JSON.stringify(doc)
    const preview = previewNativeAgentRouting(doc, 'successful',
      ['opencode', 'codex', 'claude', 'copilot', 'continue', 'opencode2'])
    expect(preview.installedAgents).toEqual([
      'claude', 'codex', 'copilot', 'opencode2', 'opencode', 'continue'
    ])
    expect(preview.approvedPlanId).toBe('plan-lab')
    expect(preview.tasks).toHaveLength(2)
    expect(preview.tasks[1]?.dependsOn).toEqual(['forge-lab-01'])
    expect(preview.tasks.every(task =>
      task.placement === 'reconcile-first' && !task.executionAuthorized
    )).toBe(true)
    expect(preview.executionAuthorized).toBe(false)
    expect(preview.hostSessionEvidenceVerified).toBe(false)
    expect(JSON.stringify(doc)).toBe(original)
  })

  it('fails closed on missing, stale or failed host detection', () => {
    for (const status of ['pending', 'failed', 'unsupported-host'] as const) {
      const preview = previewNativeAgentRouting(lab(), status, ['codex'])
      expect(preview.installedAgents).toEqual([])
      expect(preview.tasks[0]?.agentCandidates).toEqual([])
    }
  })

  it('respects disabled preferences and does not invent absent CLI providers', () => {
    const preview = previewNativeAgentRouting(lab(), 'successful',
      ['codex', 'codex', 'claude', 'openclaw'], ['claude', 'openclaw'])
    expect(preview.installedAgents).toEqual(['codex'])
    expect(preview.tasks[0]?.agentCandidates).toEqual(['codex'])
  })

  it('does not route an unapproved plan', () => {
    const doc = lab()
    doc.intelligence!.decisions = []
    const preview = previewNativeAgentRouting(doc, 'successful', ['opencode'])
    expect(preview.approvedPlanId).toBeNull()
    expect(preview.tasks).toHaveLength(0)
  })

  it('covers the Orca catalogue instead of the historical four agents', () => {
    const agents = [...TUI_AGENT_AUTO_PICK_ORDER]
    const preview = previewNativeAgentRouting(lab(), 'successful', agents)
    expect(preview.installedAgents).toEqual(agents)
    expect(preview.installedAgents.length).toBeGreaterThan(40)
    expect(preview.tasks[0]?.agentCandidates).toContain('copilot')
  })

  it('supports old documents without intelligence', () => {
    expect(previewNativeAgentRouting(emptyProjectHub('repo:old'), 'successful',
      ['claude']).tasks).toEqual([])
  })
})
