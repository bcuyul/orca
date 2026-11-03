/** A privacy-bounded breadcrumb for uncertain agent launches.
 * Diagnostic stage is not proof that a filesystem/PTY side effect did not occur. */
import type { AgentLaunchTarget } from '../../../../shared/agent-launch-intent'
import type { TerminalSpawnDispatch } from '../../../agent-launch/agent-launch-not-started'

export type AgentLaunchDiagnosticStage =
  | 'intent_resolved'
  | 'worktree_create'
  | 'mode_settle'
  | 'surface_create'

export function logAgentLaunchFailure(input: {
  error: unknown
  operationId: string
  agent: string
  targetKind: AgentLaunchTarget['kind']
  stage: AgentLaunchDiagnosticStage
  terminalSpawn: TerminalSpawnDispatch
}): void {
  const { error, operationId, agent, targetKind, stage, terminalSpawn } = input
  // A raw error message/stack can include prompts, paths or secrets; restrict even class/code fields.
  const rawName = error instanceof Error ? error.name : typeof error
  const errorName = /^[A-Za-z0-9_.-]{1,100}$/.test(rawName) ? rawName : 'UnknownError'
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(error.code)
      ? error.code
      : undefined
  console.warn('[agent-launch] launch execution rejected', {
    operationId,
    agent,
    targetKind,
    stage,
    errorName,
    ...(errorCode ? { errorCode } : {}),
    ptyDispatchAbsenceProven: terminalSpawn.failedBeforeDispatch(error)
  })
}
