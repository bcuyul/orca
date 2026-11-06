import { describe, expect, it } from 'vitest'
import { UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH } from '../../../shared/runtime-types'
import { reconcileHubSessionInventory } from './project-hub-session-inventory-guard'

const request = { sessionId: 'codex_123_456', agent: 'codex' as const, worktreeId: 'wt-1' }
function snapshot(worktree = 'wt-1', agent = 'codex') {
  return {
    worktree, publicationEpoch: 'host-published-epoch',
    snapshotVersion: 3, activeGroupId: null, activeTabId: null,
    activeTabType: null,
    tabs: [{
      type: 'agent-session', id: 'agent-session:' + request.sessionId, sessionId: request.sessionId,
      title: 'Native session', isActive: false, agent
    }]
  }
}
describe('Project Hub native host inventory guard', () => {
  it('recognizes one matching host-owned tab without granting execution', () => {
    expect(reconcileHubSessionInventory({ snapshots: [snapshot()] }, request))
      .toEqual({
        kind: 'confirmed', sessionId: request.sessionId, agent: request.agent,
        worktreeId: 'wt-1', tabId: 'agent-session:' + request.sessionId,
        source: 'host-inventory', executionAuthorized: false
      })
    expect(reconcileHubSessionInventory({
      snapshots: [snapshot('id:wt-1')]
    }, request).kind).toBe('confirmed')
  })
  it('fails closed on unverifiable, absent or conflicting sessions', () => {
    const cases = [
      {}, { snapshots: [] }, { snapshots: [snapshot('wt-2')] },
      { snapshots: [snapshot(), snapshot('wt-2')] },
      { snapshots: [snapshot(), snapshot()] },
      { snapshots: [snapshot('wt-1', 'claude')] },
      { snapshots: [{ ...snapshot(), agentSessionsUnverifiable: true }] },
      { snapshots: [{ ...snapshot(), publicationEpoch: UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH }] },
      { snapshots: [{ ...snapshot(), tabs: null }] },
      { snapshots: [{ ...snapshot(), tabs: [] }] },
      { snapshots: [{ ...snapshot(), tabs: [{ ...snapshot().tabs[0], id: 'agent-session:forged' }] }] }
    ]
    for (const response of cases) {
      expect(reconcileHubSessionInventory(response, request).kind)
        .toBe('reconcile-first')
    }
  })
  it('rejects a forged or malformed provider identity', () => {
    expect(reconcileHubSessionInventory({ snapshots: [snapshot()] },
      { ...request, sessionId: 'wrong_session' }).kind).toBe('reconcile-first')
  })
})
