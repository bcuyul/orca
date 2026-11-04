import { describe, expect, it } from 'vitest'
import {
  recommendSessionPlacement, type PlacementInput, type PlacementSession
} from './session-placement'

const sha = 'a'.repeat(40)
const sample = (): PlacementInput => ({
  task: {
    id: 'forge-lab-01', projectId: 'repo:lab', repoId: 'repo-lab', hostId: 'local',
    worktreeId: 'worktree-lab', expectedHeadSha: sha,
    role: 'forge', agentId: 'opencode', requiresWrite: true, parallelIndependentUnit: false
  },
  worktree: {
    id: 'worktree-lab', projectId: 'repo:lab', repoId: 'repo-lab', hostId: 'local',
    headSha: sha, clean: true, readOnlySnapshot: false,
    activeWriterSessionIds: [], hostObserved: true
  },
  agentInstalledAndEnabled: true,
  sessions: [],
  approvedProjectMemoryCount: 0
})
const session = (): PlacementSession => ({
  id: 'session-forge', projectId: 'repo:lab', repoId: 'repo-lab',
  hostId: 'local', worktreeId: 'worktree-lab', taskId: 'forge-lab-01',
  agentId: 'opencode', role: 'forge', headSha: sha,
  state: 'idle', context: 'usable', hostObserved: true, generationCurrent: true
})

describe('Adaptive session and worktree placement (advisory only)', () => {
  it('reuses a proven idle session on the same task and commit, never granting execution', () => {
    const input = sample()
    input.sessions = [session()]
    const result = recommendSessionPlacement(input)
    expect(result).toMatchObject({
      choice: 'reuse-session', existingSessionId: 'session-forge',
      memory: 'existing-session-context', executionAuthorized: false
    })
  })

  it('uses fresh context and only approved same-project memory when the context is near its limit', () => {
    const input = sample()
    input.sessions = [{ ...session(), context: 'near-limit' }]
    input.approvedProjectMemoryCount = 2
    expect(recommendSessionPlacement(input)).toMatchObject({
      choice: 'new-session', existingSessionId: null, memory: 'approved-project-memory',
      executionAuthorized: false
    })
  })

  it('does not resend to a busy, stale-generation or unconfirmed session', () => {
    for (const modification of [
      { state: 'busy' as const },
      { state: 'unknown' as const },
      { generationCurrent: false },
      { hostObserved: false }
    ]) {
      const input = sample()
      input.sessions = [{ ...session(), ...modification }]
      expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
    }
  })

  it('does not leak or reuse a session from another project, host or agent', () => {
    const input = sample()
    input.sessions = [
      { ...session(), projectId: 'repo:other' },
      { ...session(), hostId: 'remote' },
      { ...session(), agentId: 'claude' }
    ]
    expect(recommendSessionPlacement(input)).toMatchObject({
      choice: 'new-session', memory: 'none', existingSessionId: null
    })
  })

  it('proposes a new worktree for parallel writers and active worktree ownership', () => {
    const input = sample()
    input.task.parallelIndependentUnit = true
    expect(recommendSessionPlacement(input).choice).toBe('new-worktree')
    input.task.parallelIndependentUnit = false
    input.worktree.activeWriterSessionIds = ['session-other-task']
    expect(recommendSessionPlacement(input).choice).toBe('new-worktree')
  })

  it('requires reconciliation of dirty worktrees, changed HEAD and missing host proof', () => {
    const input = sample()
    input.worktree.clean = false
    expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
    input.worktree.clean = true
    input.worktree.headSha = 'b'.repeat(40)
    expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
    input.worktree.headSha = sha
    input.worktree.hostObserved = false
    expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
    input.worktree.hostObserved = true
    input.agentInstalledAndEnabled = false
    expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
  })

  it('always proposes a fresh independent QA session and read-only snapshot', () => {
    const input = sample()
    input.task.role = 'qa'
    input.task.requiresWrite = false
    input.sessions = [{ ...session(), role: 'qa' }]
    expect(recommendSessionPlacement(input)).toMatchObject({
      choice: 'new-worktree', existingSessionId: null, executionAuthorized: false
    })
    input.worktree.readOnlySnapshot = true
    expect(recommendSessionPlacement(input)).toMatchObject({
      choice: 'new-session', existingSessionId: null, memory: 'none'
    })
    input.task.requiresWrite = true
    expect(recommendSessionPlacement(input).choice).toBe('reconcile-first')
  })

  it('refuses malformed or oversized evidence instead of inventing a route', () => {
    const input = sample()
    input.task.expectedHeadSha = 'not-a-commit'
    expect(() => recommendSessionPlacement(input)).toThrow('invalid_session_placement_evidence')
    input.task.expectedHeadSha = sha
    input.approvedProjectMemoryCount = 101
    expect(() => recommendSessionPlacement(input)).toThrow('invalid_session_placement_evidence')
  })
})
