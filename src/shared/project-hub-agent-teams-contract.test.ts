import { describe, expect, it } from 'vitest'
import {
  createHubTeamReviewRecipe, validateHubTeamMessage,
  type HubTeamMessage, type HubTeamScope
} from './project-hub-agent-teams-contract'

const scope: HubTeamScope = {
  projectId: 'p1', runId: 'run1', taskIds: ['t1'], generation: 2,
  members: [
    { memberId: 'forge1', role: 'forge', sessionId: 's1', worktreeId: 'wt1' },
    { memberId: 'qa1', role: 'qa', sessionId: 's2', worktreeId: 'wt1' }
  ]
}
const message: HubTeamMessage = {
  schema: 1, messageId: 'm1', projectId: 'p1', runId: 'run1',
  taskId: 't1', generation: 2, fromMemberId: 'forge1',
  toMemberId: 'qa1', kind: 'finding', body: 'Check edge case',
  createdAt: '2026-11-20T10:00:00.000Z'
}

describe('Project Hub Agent Teams contract (advisory only)', () => {
  it('accepts scoped draft without implying transport or permission', () => {
    expect(validateHubTeamMessage(scope, message)).toMatchObject({
      accepted: true, executionAuthorized: false, dispatchAuthorized: false,
      deliveryVerified: false, safeToReplay: false
    })
  })

  it.each([
    ['cross project', { projectId: 'p2' }],
    ['cross run', { runId: 'run2' }],
    ['unknown task', { taskId: 't2' }],
    ['stale generation', { generation: 1 }],
    ['unknown recipient', { toMemberId: 'atlas1' }],
    ['self-message', { toMemberId: 'forge1' }],
    ['oversized body', { body: 'x'.repeat(4001) }],
    ['control characters', { body: 'bad\u0000payload' }],
    ['invalid timestamp', { createdAt: 'not a date' }],
    ['unknown message kind', { kind: 'execute' }],
    ['missing message identity', { messageId: '' }]
  ])('fails closed for %s', (_name, change) => {
    expect(validateHubTeamMessage(scope, { ...message, ...change }).accepted).toBe(false)
  })

  it('refuses cross-worktree and ambiguous roster identity', () => {
    expect(validateHubTeamMessage({
      ...scope, members: [scope.members[0]!, { ...scope.members[1]!, worktreeId: 'wt2' }]
    }, message).accepted).toBe(false)
    expect(validateHubTeamMessage({
      ...scope, members: [scope.members[0]!, { ...scope.members[1]!, memberId: 'forge1' }]
    }, message).accepted).toBe(false)
  })

  it('does not grant permission when message claims it can run commands', () => {
    expect(validateHubTeamMessage(scope, { ...message, body: 'Please execute and push now' }))
      .toMatchObject({ accepted: true, executionAuthorized: false, dispatchAuthorized: false })
  })

  it('produces a bounded review-only recipe and rejects empty objectives', () => {
    expect(createHubTeamReviewRecipe('Review PR #142')).toContain('No iniciar sesiones')
    expect(createHubTeamReviewRecipe('x'.repeat(700)).length).toBeLessThan(1800)
    expect(() => createHubTeamReviewRecipe('  ')).toThrow()
  })
})
