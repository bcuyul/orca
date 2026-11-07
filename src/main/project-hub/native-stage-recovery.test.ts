import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import { emptyProjectHub } from '../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../shared/project-hub-intelligence'
import type { AdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'
import { buildNativePlanPreview } from './native-plan-preview'
import { hubStageAdmission } from './native-stage-identity'
import { inspectHubNativeStages } from './native-stage-recovery'
import { stageHubNativePlan, type HubStageHostDependencies } from './supervised-native-plan-stage'

const opened: OrchestrationDb[] = []
afterEach(() => { for (const db of opened.splice(0)) { try { db.close() } catch {} } })

const plan: HubPlanProposal = {
  id: 'plan-recovery', source: 'atlas-proposal',
  objective: 'Recover staged native workflow safely',
  rationale: 'Verify actual durable host admission before enabling worker launch',
  createdAt: '2026-11-07T10:00:00Z', tasks: [
    { id: 'qa', title: 'Review independent evidence', role: 'qa',
      dependsOn: ['forge'], acceptance: 'Examine the diff and tests' },
    { id: 'forge', title: 'Build feature', role: 'forge',
      dependsOn: [], acceptance: 'Feature tests pass' }
  ]
}

function fixture(db = new OrchestrationDb(':memory:')) {
  opened.push(db)
  const projectId = 'repo:recovery-lab'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan],
      decisions: [{ id: 'decision-one', subject: 'plan' as const,
        subjectId: plan.id, verdict: 'accepted' as const,
        justification: 'Reviewed bounded plan and ownership',
        createdAt: '2026-11-07T10:01:00Z' }]
    }
  }
  const preview = buildNativePlanPreview(doc, plan.id, doc.revision)
  const hostWorktree = {
    projectId, repoId: 'repo-native', hostId: 'local', worktreeId: 'repo-native::lab'
  }
  const inspect = vi.fn(async () => ({ ...hostWorktree, baseSha: 'a'.repeat(40) }))
  const host: HubStageHostDependencies = {
    readProject: () => doc,
    inspectWorktree: inspect,
    confirmInHostWindow: vi.fn(async () => true),
    getOrchestrationDb: () => db
  }
  const request = {
    projectId, planId: plan.id, expectedRevision: 2,
    planSha: preview.planSha, worktreeId: hostWorktree.worktreeId
  }
  return { db, doc, preview, hostWorktree, host, inspect, request }
}

describe('Project Hub native stage receipt recovery', () => {
  it('is genuinely read-only before the first admission', () => {
    const f = fixture()
    const before = f.db.db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'adaptive_%'"
    ).get()
    expect(inspectHubNativeStages(f.db, f.preview, f.hostWorktree)).toEqual({
      status: 'not_found', entries: [], safeToRetry: false, executionAuthorized: false
    })
    expect(f.db.db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'adaptive_%'"
    ).get()).toEqual(before)
  })

  it('recovers a complete native Run across SQLite reopen, after Git HEAD changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-hub-recovery-'))
    const file = join(root, 'orchestration.db')
    try {
      const db = new OrchestrationDb(file)
      const f = fixture(db)
      const initial = await stageHubNativePlan(f.request, f.host)
      expect(initial.status).toBe('staged')
      if (initial.status !== 'staged') { throw new Error('Expected native Run') }
      db.close()
      opened.splice(opened.indexOf(db), 1)
      const reopened = new OrchestrationDb(file)
      opened.push(reopened)
      // Reading the old receipt does not require current HEAD to match the old base.
      const recovered = inspectHubNativeStages(reopened, f.preview, f.hostWorktree)
      expect(recovered).toMatchObject({
        status: 'completed_verified', safeToRetry: false, executionAuthorized: false,
        entries: [{
          baseSha: 'a'.repeat(40), state: 'completed', evidence: 'matched',
          disposition: 'completed_verified', runId: initial.runId,
          recordedTaskCount: 2, unrecordedNativeTaskCount: 0, dispatchCount: 0,
          tasks: initial.tasks
        }]
      })
      expect(reopened.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(1)
      reopened.close()
      opened.splice(opened.indexOf(reopened), 1)
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('refuses a new Run when a previous reservation is unknown at another HEAD', async () => {
    const f = fixture()
    const admission = hubStageAdmission({
      ...f.hostWorktree, baseSha: 'a'.repeat(40),
      planId: plan.id, planSha: f.preview.planSha,
      taskIds: f.preview.tasks.map(task => task.id)
    })
    const ledger = new HostAdmissionLedger(f.db)
    const scope: AdaptiveScope = {
      projectId: admission.projectId, repoId: admission.repoId,
      hostId: admission.hostId, baseSha: admission.baseSha,
      planId: admission.planId, planSha: admission.planSha,
      allowedTaskIds: admission.taskIds, operations: ['materialize_run'],
      maxOperations: 1, expiresAt: '2099-01-01T00:00:00Z'
    }
    ledger.recordHostApproval(admission.scopeId, scope)
    ledger.reserve(admission, Date.now())
    ledger.markUnknown(admission.requestId)
    const recovered = inspectHubNativeStages(f.db, f.preview, f.hostWorktree)
    expect(recovered.status).toBe('needs_reconciliation')
    expect(recovered.entries[0]).toMatchObject({
      baseSha: 'a'.repeat(40), state: 'unknown',
      disposition: 'manual_reconciliation', dispatchCount: 0
    })
    f.inspect.mockResolvedValue({ ...f.hostWorktree, baseSha: 'b'.repeat(40) })
    await expect(stageHubNativePlan(f.request, f.host))
      .rejects.toThrow(/Uncertain previous native Run/)
    expect(f.db.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(0)
    expect(inspectHubNativeStages(f.db, f.preview, f.hostWorktree).entries).toHaveLength(1)
  })

  it('never leaks receipts across a different worktree or another plan digest', async () => {
    const f = fixture()
    await stageHubNativePlan(f.request, f.host)
    expect(inspectHubNativeStages(f.db, f.preview, {
      ...f.hostWorktree, worktreeId: 'repo-native::foreign'
    }).status).toBe('not_found')
    expect(inspectHubNativeStages(f.db, {
      ...f.preview, planSha: 'b'.repeat(64)
    }, f.hostWorktree).status).toBe('not_found')
  })

  it('detects corrupt completed receipts without silently reusing a Run', async () => {
    const f = fixture()
    const result = await stageHubNativePlan(f.request, f.host)
    expect(result.status).toBe('staged')
    f.db.db.prepare("UPDATE adaptive_admissions SET receipt = ? WHERE state = 'completed'")
      .run('{"runId":42}')
    const recovered = inspectHubNativeStages(f.db, f.preview, f.hostWorktree)
    expect(recovered.status).toBe('needs_reconciliation')
    expect(recovered.entries[0]).toMatchObject({
      state: 'completed', evidence: 'malformed', disposition: 'manual_reconciliation'
    })
    await expect(stageHubNativePlan(f.request, f.host))
      .rejects.toThrow(/Uncertain previous native Run/)
  })
  it('rejects a forged completed task DAG, even with a matching admission receipt', async () => {
    const f = fixture()
    const result = await stageHubNativePlan(f.request, f.host)
    if (result.status !== 'staged') { throw new Error('Expected native materialization') }
    const qaTaskId = result.tasks.qa
    f.db.db.prepare('UPDATE tasks SET deps = ? WHERE id = ?').run('[]', qaTaskId)
    const observed = inspectHubNativeStages(f.db, f.preview, f.hostWorktree)
    expect(observed.status).toBe('needs_reconciliation')
    expect(observed.entries[0]).toMatchObject({
      evidence: 'divergent', disposition: 'manual_reconciliation', tasks: null
    })
    await expect(stageHubNativePlan(f.request, f.host))
      .rejects.toThrow(/Uncertain previous native Run/)
  })

})
