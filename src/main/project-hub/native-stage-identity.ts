import { createHash } from 'node:crypto'
import type { AdaptiveRequest } from '../../shared/adaptive-delivery/admission-contracts'

export type HubStageIdentity = {
  projectId: string
  repoId: string
  hostId: string
  worktreeId: string
  baseSha: string
  planId: string
  planSha: string
  taskIds: string[]
}

/** Keep the operation identity stable across Electron processes and restarts. */
export function hubStageAdmission(input: HubStageIdentity): AdaptiveRequest {
  const digest = createHash('sha256').update(JSON.stringify({
    projectId: input.projectId, repoId: input.repoId,
    hostId: input.hostId, worktreeId: input.worktreeId,
    baseSha: input.baseSha, planId: input.planId, planSha: input.planSha
  })).digest('hex').slice(0, 40)
  return {
    scopeId: `hub-stage-${digest}`,
    requestId: `hub-stage-request-${digest}`,
    projectId: input.projectId, repoId: input.repoId,
    hostId: input.hostId, baseSha: input.baseSha,
    planId: input.planId, planSha: input.planSha,
    taskIds: [...input.taskIds], operation: 'materialize_run'
  }
}
