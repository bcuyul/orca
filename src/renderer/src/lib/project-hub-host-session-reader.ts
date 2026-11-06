/** Read-only host inventory, never authorizes a Project Hub operation. */
import type { TuiAgent } from '../../../shared/tui-agent'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  reconcileHubSessionInventory, type HubSessionInventoryDecision
} from './project-hub-session-inventory-guard'

export type HubLocalSessionIdentity = {
  worktreeId: string
  sessionId: string
  agent: TuiAgent
}

/** Local-only; remote owners need separate authenticated host/fence evidence. */
export async function readHubLocalSessionInventory(
  request: HubLocalSessionIdentity
): Promise<HubSessionInventoryDecision> {
  try {
    const inventory = await callRuntimeRpc<unknown>(
      { kind: 'local' }, 'session.tabs.listAll', {}
    )
    return reconcileHubSessionInventory(inventory, request)
  } catch {
    return {
      kind: 'reconcile-first', reason: 'Host inventory unavailable',
      executionAuthorized: false
    }
  }
}
