/** Read-only status summary; never infer a live process from a launch receipt. */
import type { HubDelegation } from './project-hub-delegation'

export type HubDelegationCapacity = {
  launched: number
  launching: number
  unconfirmed: number
  held: number
  available: number
}

/** Unknown, in-flight and launched records all retain slots until a separately audited reconciliation exists. */
export function summarizeHubDelegationCapacity(
  rows: readonly HubDelegation[],
  repoId: string,
  hostId: string,
  limit: number
): HubDelegationCapacity {
  const scoped = rows.filter((row) => row.repoId === repoId && row.hostId === hostId)
  const launched = scoped.filter((row) => row.status === 'launched').length
  const launching = scoped.filter((row) => row.status === 'launching').length
  const unconfirmed = scoped.filter((row) => row.status === 'unconfirmed').length
  const held = launched + launching + unconfirmed
  return {
    launched,
    launching,
    unconfirmed,
    held,
    available: Math.max(0, limit - held)
  }
}
