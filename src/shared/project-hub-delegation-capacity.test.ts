import { describe, expect, it } from 'vitest'
import type { HubDelegation } from './project-hub-delegation'
import { summarizeHubDelegationCapacity } from './project-hub-delegation-capacity'

function delegation(
  status: HubDelegation['status'],
  index: number,
  repoId = 'repoA',
  hostId = 'local'
): HubDelegation {
  return {
    id: `hub-${index.toString(16).padStart(32, '0')}`,
    storyId: `PH-${String(index).padStart(3, '0')}`,
    agent: 'opencode',
    reviewer: 'codex',
    operationId: `1793290000000-${index.toString(16).padStart(32, '0')}`,
    name: `ph-${index}`,
    baseBranch: 'test/project-hub-hermes',
    repoId,
    hostId,
    status,
    createdAt: '2026-10-29T12:00:00Z'
  }
}

describe('Project Hub slot accounting', () => {
  it('does not count an uncertain launch as a confirmed start, but retains its slot', () => {
    const summary = summarizeHubDelegationCapacity([delegation('unconfirmed', 1)], 'repoA', 'local', 2)
    expect(summary).toEqual({
      launched: 0, launching: 0, unconfirmed: 1, held: 1, available: 1
    })
  })

  it('keeps all launched and uncertain reservations without claiming agents are live', () => {
    const rows = [
      delegation('launched', 1),
      delegation('launching', 2),
      delegation('unconfirmed', 3),
      delegation('planned', 4),
      delegation('launched', 5, 'repoB'),
      delegation('unconfirmed', 6, 'repoA', 'other-host')
    ]
    expect(summarizeHubDelegationCapacity(rows, 'repoA', 'local', 2)).toEqual({
      launched: 1, launching: 1, unconfirmed: 1, held: 3, available: 0
    })
  })

  it('preserves all slots for plans that have not launched', () => {
    expect(summarizeHubDelegationCapacity([delegation('planned', 1)], 'repoA', 'local', 3))
      .toEqual({ launched: 0, launching: 0, unconfirmed: 0, held: 0, available: 3 })
  })
})
