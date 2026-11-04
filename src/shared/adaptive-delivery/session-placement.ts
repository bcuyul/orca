/** Advisory session/worktree placement for Project Hub.
 * Does not authenticate its own inputs or create a session, worktree or execution grant.
 * The host must supply observed facts and enforce every effect independently. */
export type PlacementRole = 'atlas' | 'forge' | 'flow' | 'data' | 'qa'
export type PlacementChoice = 'reuse-session' | 'new-session' | 'new-worktree' | 'reconcile-first'
export type PlacementMemory = 'existing-session-context' | 'approved-project-memory' | 'none'

export type PlacementSession = {
  id: string
  projectId: string
  repoId: string
  hostId: string
  worktreeId: string
  taskId: string
  agentId: string
  role: PlacementRole
  headSha: string
  state: 'idle' | 'busy' | 'unknown' | 'closed'
  context: 'usable' | 'near-limit' | 'unknown'
  /** Host observations, not self-reported model text or Project Hub JSON. */
  hostObserved: boolean
  generationCurrent: boolean
}
export type PlacementInput = {
  task: {
    id: string
    projectId: string
    repoId: string
    hostId: string
    worktreeId: string
    expectedHeadSha: string
    role: PlacementRole
    agentId: string
    requiresWrite: boolean
    parallelIndependentUnit: boolean
  }
  worktree: {
    id: string
    projectId: string
    repoId: string
    hostId: string
    headSha: string
    clean: boolean
    readOnlySnapshot: boolean
    activeWriterSessionIds: string[]
    hostObserved: boolean
  }
  /** Availability must be obtained from Orca's native agent detection on this host. */
  agentInstalledAndEnabled: boolean
  sessions: PlacementSession[]
  /** Count of explicitly approved, same-project memories; no cross-project search. */
  approvedProjectMemoryCount: number
}
export type PlacementRecommendation = {
  choice: PlacementChoice
  existingSessionId: string | null
  memory: PlacementMemory
  reasons: string[]
  /** This policy is advisory. Sending, spawning, or materializing requires separate host grants. */
  executionAuthorized: false
}

const SHA = /^[0-9a-f]{40}$/i
const roleNames = new Set<PlacementRole>(['atlas', 'forge', 'flow', 'data', 'qa'])
const validName = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 300

/**
 * Deterministic O(n) routing preview with fail-closed recovery.
 * Only a host-bound caller may provide reliable session identities. The output never
 * proves those facts and is NEVER a substitute for native Coordinator admission.
 */
export function recommendSessionPlacement(input: PlacementInput): PlacementRecommendation {
  const { task, worktree, sessions } = input
  if (!task || !worktree || !Array.isArray(sessions) || sessions.length > 100 ||
      ![task.id, task.projectId, task.repoId, task.hostId, task.worktreeId,
        task.agentId, worktree.id, worktree.projectId, worktree.repoId, worktree.hostId]
        .every(validName) ||
      !SHA.test(task.expectedHeadSha) || !SHA.test(worktree.headSha) ||
      !roleNames.has(task.role) || typeof task.requiresWrite !== 'boolean' ||
      typeof task.parallelIndependentUnit !== 'boolean' ||
      typeof worktree.clean !== 'boolean' ||
      typeof worktree.readOnlySnapshot !== 'boolean' ||
      typeof worktree.hostObserved !== 'boolean' ||
      !Array.isArray(worktree.activeWriterSessionIds) ||
      worktree.activeWriterSessionIds.length > 100 ||
      !worktree.activeWriterSessionIds.every(validName) ||
      typeof input.agentInstalledAndEnabled !== 'boolean' ||
      !Number.isSafeInteger(input.approvedProjectMemoryCount) ||
      input.approvedProjectMemoryCount < 0 ||
      input.approvedProjectMemoryCount > 100) {
    throw new Error('invalid_session_placement_evidence')
  }
  for (const session of sessions) {
    if (!session || ![session.id, session.projectId, session.repoId,
      session.hostId, session.worktreeId, session.taskId, session.agentId].every(validName) ||
      !SHA.test(session.headSha) || !roleNames.has(session.role) ||
      !['idle', 'busy', 'unknown', 'closed'].includes(session.state) ||
      !['usable', 'near-limit', 'unknown'].includes(session.context) ||
      typeof session.hostObserved !== 'boolean' ||
      typeof session.generationCurrent !== 'boolean') {
      throw new Error('invalid_session_placement_evidence')
    }
  }

  const fallbackMemory: PlacementMemory = input.approvedProjectMemoryCount > 0 ?
    'approved-project-memory' : 'none'
  function recommend(choice: PlacementChoice, reason: string, sessionId: string | null = null):
    PlacementRecommendation {
    return {
      choice, existingSessionId: sessionId,
      memory: choice === 'reuse-session' ? 'existing-session-context' :
        choice === 'reconcile-first' ? 'none' : fallbackMemory,
      reasons: [reason], executionAuthorized: false
    }
  }

  if (!worktree.hostObserved || !input.agentInstalledAndEnabled) {
    return recommend('reconcile-first', 'Host evidence or enabled agent is unavailable')
  }
  if (worktree.id !== task.worktreeId || worktree.projectId !== task.projectId ||
      worktree.repoId !== task.repoId || worktree.hostId !== task.hostId ||
      worktree.headSha !== task.expectedHeadSha) {
    return recommend('reconcile-first', 'Project, worktree, host, or Git HEAD differs from task')
  }
  if (task.role === 'qa' && task.requiresWrite) {
    return recommend('reconcile-first', 'Independent QA cannot require workspace write access')
  }

  // Independent QA never inherits Forge's conversation or a mutable writer workspace.
  if (task.role === 'qa') {
    if (!worktree.readOnlySnapshot || !worktree.clean ||
        worktree.activeWriterSessionIds.length > 0) {
      return recommend('new-worktree', 'QA needs a separate read-only snapshot at the reviewed SHA')
    }
    return recommend('new-session', 'QA requires a fresh independent reviewer session')
  }

  // A parallel writer is isolated even when its task could fit in an old chat.
  if (task.requiresWrite &&
      (task.parallelIndependentUnit || worktree.activeWriterSessionIds.length > 0)) {
    return recommend('new-worktree', 'Parallel or concurrent writes need an isolated worktree')
  }

  const matching = sessions.filter(session =>
    session.projectId === task.projectId && session.repoId === task.repoId &&
    session.hostId === task.hostId && session.worktreeId === task.worktreeId &&
    session.taskId === task.id && session.role === task.role &&
    session.agentId === task.agentId && session.state !== 'closed'
  )
  if (matching.some(session =>
    !session.hostObserved || !session.generationCurrent ||
    session.state === 'unknown' || session.context === 'unknown')) {
    return recommend('reconcile-first', 'Session identity or state is unconfirmed; do not resend')
  }
  if (matching.some(session => session.state === 'busy')) {
    return recommend('reconcile-first', 'Existing task session is busy; avoid duplicate dispatch')
  }
  const reusable = matching.find(session =>
    session.state === 'idle' && session.context === 'usable' &&
    session.headSha === task.expectedHeadSha
  )
  if (reusable) {
    return recommend('reuse-session', 'Same task, agent, host, worktree, SHA and usable context',
      reusable.id)
  }
  if (!worktree.clean) {
    return recommend('reconcile-first', 'Uncommitted edits prevent starting a different session')
  }
  return recommend('new-session', 'Start fresh in the current clean worktree; do not copy unapproved memory')
}
