/** Dispatch a launch through Orca's native worktree and terminal/session surfaces.
 * Keeps the actual execution and launch placement separate from replay admission. */
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import { executeAgentLaunch } from '../../../agent-launch/agent-launch-executor'
import type { TerminalSpawnDispatch } from '../../../agent-launch/agent-launch-not-started'
import type { RpcContext } from '../core'
import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'
import { agentLaunchCallerNavigationId, selectAgentLaunchTabForCaller } from './agent-launch-caller-selection'
import { agentLaunchWorkspaceFactory } from './agent-launch-worktree-creation'
import { resolveUnlaunchedIntent } from './agent-launch-intent-resolution'
import { withPlacement, type AgentLaunchView } from './agent-launch-tab-publication'

/** What a launch admitted under an operation id carries into its execution. */
type ReplaySafeLaunch = {
  attachOperationId: string
  callerKey: string
  terminalSpawn: TerminalSpawnDispatch
  /** Queue provisional surface/prompt recording without awaiting it; ordered ledger transactions keep final settlement after it. */
  recordSurface: (provisional: AgentLaunchResult) => void
  /** Diagnostics only: a stage marker, not an assertion about side effects. */
  onStage?: (stage: 'worktree_create' | 'mode_settle' | 'surface_create') => void
}

export async function runAgentLaunch(
  { intent, decidedMode }: Awaited<ReturnType<typeof resolveUnlaunchedIntent>>,
  context: RpcContext,
  view: AgentLaunchView,
  replaySafe?: ReplaySafeLaunch
): Promise<AgentLaunchResult> {
  const callerNavigationId = agentLaunchCallerNavigationId(intent.target, context)
  const result = await executeAgentLaunch({
    runtime: context.runtime,
    intent,
    decidedMode,
    surfaces: agentLaunchSurfaceFactory(
      context,
      replaySafe?.attachOperationId,
      replaySafe?.callerKey,
      callerNavigationId !== null,
      replaySafe?.terminalSpawn,
      view
    ),
    workspaces: agentLaunchWorkspaceFactory(context, intent.agent),
    ...(replaySafe?.onStage ? { onStage: replaySafe.onStage } : {}),
    // The tab is shown as it is published, not after a prompt that can take a minute to land.
    onSurfacePublished: (surface) => {
      view.early?.surfacePublished(surface)
      replaySafe?.recordSurface(withPlacement(surface, view))
      if (callerNavigationId !== null && view.presentation !== 'background') {
        selectAgentLaunchTabForCaller(context.runtime, surface, callerNavigationId)
      }
    }
  })
  return withPlacement(result, view)
}

