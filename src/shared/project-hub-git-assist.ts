/** Read-only Git handoff snapshot using Orca's existing native inspection results.
 * A snapshot is not a host admission receipt, a CI check or an execution grant. */
import type { GitStatusResult } from './git-status-types'
import type { GitHistoryResult } from './git-history'

const COMMIT_SHA = /^[a-f0-9]{40}$/i

export type HubLocalGitSnapshot = {
  headSha: string
  branch: string | null
  clean: true
  source: 'native-git-readonly'
  verifiedForExecution: false
}

/** Reject inconsistent/stale, truncated, dirty and unsupported Git observations. */
export function projectHubLocalGitSnapshot(
  status: GitStatusResult,
  history: GitHistoryResult
): HubLocalGitSnapshot {
  if (!status || !history || !Array.isArray(status.entries) ||
      !Array.isArray(history.items) || status.readError ||
      status.didHitLimit || status.entries.length !== 0 ||
      (status.conflictOperation !== 'unknown' && status.conflictOperation !== undefined)) {
    throw new Error('Git no confirma un árbol limpio; revisa los cambios antes de capturar.')
  }
  const head = status.head
  if (typeof head !== 'string' || !COMMIT_SHA.test(head) ||
      history.currentRef?.revision !== head ||
      history.items[0]?.id !== head) {
    throw new Error('Git HEAD es desconocido o cambió durante la inspección; vuelve a leer.')
  }
  return {
    headSha: head.toLowerCase(),
    branch: typeof status.branch === 'string' && status.branch.trim()
      ? status.branch : null,
    clean: true,
    source: 'native-git-readonly',
    verifiedForExecution: false
  }
}

/** Keep captured baseline distinct from a new delivery commit. */
export function projectHubGitDeliveryReference(baseSha: string, headSha: string): string {
  if (!COMMIT_SHA.test(baseSha) || !COMMIT_SHA.test(headSha) ||
      baseSha.toLowerCase() === headSha.toLowerCase()) {
    throw new Error('La entrega exige un commit HEAD diferente de la base registrada.')
  }
  return `Commit local ${headSha.toLowerCase()}; diff y CI aún no verificados`
}
