import { describe, expect, it } from 'vitest'
import type { GitHistoryResult } from './git-history'
import type { GitStatusResult } from './git-status-types'
import {
  projectHubGitDeliveryReference, projectHubLocalGitSnapshot
} from './project-hub-git-assist'

const BASE = 'a'.repeat(40)
const NEXT = 'b'.repeat(40)
const status = (head = BASE): GitStatusResult => ({
  entries: [], conflictOperation: 'unknown', head, branch: 'lab/forge-readme'
})
const history = (head = BASE): GitHistoryResult => ({
  items: [{ id: head, parentIds: [], subject: 'Lab commit', message: 'Lab commit' }],
  currentRef: { id: 'refs/heads/lab/forge-readme', name: 'lab/forge-readme',
    category: 'branches', revision: head },
  hasIncomingChanges: false, hasOutgoingChanges: false, hasMore: false, limit: 1
})

describe('Project Hub read-only local Git assist', () => {
  it('accepts two mutually consistent, clean native Git observations only', () => {
    const a = status()
    const b = history()
    const frozen = JSON.stringify({ a, b })
    const result = projectHubLocalGitSnapshot(a, b)
    expect(result).toEqual({
      headSha: BASE, branch: 'lab/forge-readme', clean: true,
      source: 'native-git-readonly', verifiedForExecution: false
    })
    expect(JSON.stringify({ a, b })).toBe(frozen)
  })

  it('rejects missing or mismatched HEAD, dirty trees, failed/truncated status', () => {
    expect(() => projectHubLocalGitSnapshot(status(), history(NEXT))).toThrow(/HEAD/)
    expect(() => projectHubLocalGitSnapshot({ ...status(), head: undefined }, history()))
      .toThrow(/HEAD/)
    expect(() => projectHubLocalGitSnapshot({ ...status(), entries: [{
      path: 'src/changed.ts', status: 'modified'
    }] } as GitStatusResult, history())).toThrow(/limpio/)
    expect(() => projectHubLocalGitSnapshot({ ...status(), readError: 'permission denied' },
      history())).toThrow(/limpio/)
    expect(() => projectHubLocalGitSnapshot({ ...status(), didHitLimit: true },
      history())).toThrow(/limpio/)
    expect(() => projectHubLocalGitSnapshot(status(),
      { ...history(), items: [] })).toThrow(/HEAD/)
  })

  it('requires distinct valid base/delivery SHA without claiming CI verification', () => {
    expect(projectHubGitDeliveryReference(BASE, NEXT)).toContain(NEXT)
    expect(projectHubGitDeliveryReference(BASE, NEXT)).toContain('no verificados')
    expect(() => projectHubGitDeliveryReference(BASE, BASE)).toThrow(/diferente/)
    expect(() => projectHubGitDeliveryReference('invalid', NEXT)).toThrow(/diferente/)
    expect(() => projectHubGitDeliveryReference(BASE, 'invalid')).toThrow(/diferente/)
  })
})
