import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readHubLocalSessionInventory } from './project-hub-host-session-reader'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.call }))
const identity = { worktreeId: 'wt-lab', sessionId: 'codex_123_456', agent: 'codex' as const }
const snapshot = {
  worktree: 'wt-lab', publicationEpoch: 'host-published-epoch', snapshotVersion: 2,
  activeGroupId: null, activeTabId: null, activeTabType: null,
  tabs: [{
    type: 'agent-session', id: 'agent-session:codex_123_456',
    sessionId: 'codex_123_456', title: 'Native chat', isActive: false, agent: 'codex'
  }]
}

beforeEach(() => mocks.call.mockReset())
describe('Project Hub host inventory reader', () => {
  it('uses read-only native inventory RPC and grants navigation only', async () => {
    mocks.call.mockResolvedValue({ snapshots: [snapshot] })
    expect(await readHubLocalSessionInventory(identity)).toEqual({
      kind: 'confirmed', ...identity, tabId: 'agent-session:codex_123_456',
      source: 'host-inventory', executionAuthorized: false
    })
    expect(mocks.call).toHaveBeenCalledOnce()
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'local' }, 'session.tabs.listAll', {}
    )
  })
  it('refuses missing, stale, duplicate, foreign or unreadable inventories', async () => {
    for (const response of [
      { snapshots: [] },
      { snapshots: [snapshot, snapshot] },
      { snapshots: [{ ...snapshot, agentSessionsUnverifiable: true }] },
      { snapshots: [{ ...snapshot, tabs: [] }] },
      { snapshots: [{ ...snapshot, tabs: [{ ...snapshot.tabs[0], agent: 'claude' }] }] }
    ]) {
      mocks.call.mockResolvedValueOnce(response)
      expect((await readHubLocalSessionInventory(identity)).kind).toBe('reconcile-first')
    }
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    expect(await readHubLocalSessionInventory(identity)).toEqual({
      kind: 'reconcile-first', reason: 'Host inventory unavailable',
      executionAuthorized: false
    })
    expect(mocks.call).toHaveBeenCalledTimes(6)
  })
})
