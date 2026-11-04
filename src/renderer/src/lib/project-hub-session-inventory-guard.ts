/** Host inventory evidence can authorize navigation only, never a Project Hub Dispatch. */
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { hostSnapshotAffirmsAgentSessions } from '@/runtime/host-session-snapshot-authority'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { isStructuredAgentSessionIdFor } from '../../../shared/structured-agent-session-create'

export type HubSessionInventoryDecision =
  | { kind: 'confirmed'; sessionId: string; agent: TuiAgent; worktreeId: string;
      tabId: string; source: 'host-inventory'; executionAuthorized: false }
  | { kind: 'reconcile-first'; reason: string; executionAuthorized: false }

const deny = (reason: string): HubSessionInventoryDecision => ({
  kind: 'reconcile-first', reason, executionAuthorized: false
})
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isSnapshot(value: unknown): value is RuntimeMobileSessionTabsResult {
  if (!object(value) || typeof value.worktree !== 'string' || !value.worktree ||
    typeof value.publicationEpoch !== 'string' ||
    !Number.isSafeInteger(value.snapshotVersion) || !Array.isArray(value.tabs)) {
    return false
  }
  return value.tabs.every(tab => object(tab) && typeof tab.type === 'string' &&
    (tab.type !== 'agent-session' || (typeof tab.sessionId === 'string' &&
      typeof tab.agent === 'string' && typeof tab.id === 'string')))
}

/** The selected host must affirm exactly one chat for this immutable launch identity. */
export function reconcileHubSessionInventory(
  response: unknown,
  request: { sessionId: string; agent: TuiAgent; worktreeId: string }
): HubSessionInventoryDecision {
  if (!request.worktreeId ||
    !isStructuredAgentSessionIdFor(request.agent, request.sessionId)) {
    return deny('Invalid session identity')
  }
  if (!object(response) || !Array.isArray(response.snapshots) ||
    response.snapshots.length > 1000 || !response.snapshots.every(isSnapshot)) {
    return deny('Host inventory is absent or malformed')
  }
  const snapshots: RuntimeMobileSessionTabsResult[] = response.snapshots
  const selector = toRuntimeWorktreeSelector(request.worktreeId)
  const selected = snapshots.filter(row =>
    row.worktree === request.worktreeId || row.worktree === selector)
  if (selected.length !== 1 || !hostSnapshotAffirmsAgentSessions(selected[0]!)) {
    return deny('Workspace inventory is missing, ambiguous, or not authoritative')
  }
  const hits = snapshots.flatMap(snapshot =>
    snapshot.tabs.filter(tab =>
      tab.type === 'agent-session' && tab.sessionId === request.sessionId
    ).map(tab => ({ snapshot, tab }))
  )
  if (hits.length !== 1 || hits[0]!.snapshot !== selected[0]) {
    return deny('Chat is absent, duplicated, or belongs to a different workspace')
  }
  const tab = hits[0]!.tab
  if (tab.type !== 'agent-session' || tab.agent !== request.agent) {
    return deny('The host reports a different agent')
  }
  return {
    kind: 'confirmed', sessionId: request.sessionId, agent: request.agent,
    worktreeId: request.worktreeId, tabId: tab.id, source: 'host-inventory',
    executionAuthorized: false
  }
}
