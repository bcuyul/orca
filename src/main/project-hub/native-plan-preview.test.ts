import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectHubStore } from './project-hub-store'
import { __awaitPendingWindowsDirectoryHardeningForTests } from '../../shared/secure-file'
import { restrictWindowsDirectory } from '../../shared/secure-path-windows-acl'
import { buildNativePlanPreview } from './native-plan-preview'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { HostAdmissionLedger } from '../runtime/adaptive-delivery/host-admission-ledger'
import { NativePlanMaterializer } from '../runtime/adaptive-delivery/native-plan-materializer'
import { emptyHubIntelligence, type HubPlanProposal } from '../../shared/project-hub-intelligence'
import type { AdaptiveRequest, AdaptiveScope } from '../../shared/adaptive-delivery/admission-contracts'

const plan: HubPlanProposal = {
  id: 'plan-native-preview', objective: 'Deliver an isolated example feature',
  rationale: 'Verify native dependencies with no worker launches',
  source: 'atlas-proposal', createdAt: '2026-11-03T10:00:00Z',
  tasks: [
    { id: 'qa-check', title: 'Review feature', role: 'qa',
      dependsOn: ['forge-build'], acceptance: 'Tests are green' },
    { id: 'forge-build', title: 'Build feature', role: 'forge',
      dependsOn: ['data-store'], acceptance: 'Feature works' },
    { id: 'data-store', title: 'Persist feature', role: 'data',
      dependsOn: [], acceptance: 'Records persist' }
  ]
}
const now = Date.parse('2026-11-03T10:15:00Z')

describe('Project Hub → native DAG preview → host-only Run/Task lab', () => {
  it('reads a saved proposal and decision, creates the same native DAG only after a host grant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-preview-dag-'))
    const db = new OrchestrationDb(':memory:')
    try {
      const hub = new ProjectHubStore(root)
      const projectId = 'repo:preview-lab'
      const proposed = hub.save(projectId, {
        ...hub.read(projectId),
        intelligence: { ...emptyHubIntelligence(), plans: [plan] }
      }, 0)
      const pending = buildNativePlanPreview(hub.read(projectId), plan.id, proposed.revision)
      expect(pending.approval).toBe('pending')
      expect(pending.dispatched).toBe(false)
      expect(pending.tasks.map((task) => task.id)).toEqual(['data-store', 'forge-build', 'qa-check'])
      expect(db.listRuns().runs.filter((run) => run.legacy === 0)).toHaveLength(0)

      const approved = hub.save(projectId, {
        ...proposed,
        intelligence: {
          ...proposed.intelligence!,
          decisions: [{
            id: 'decision-accepted', subject: 'plan', subjectId: plan.id,
            verdict: 'accepted', justification: 'Reviewed tasks and dependencies',
            createdAt: '2026-11-03T10:10:00Z'
          }]
        }
      }, proposed.revision)
      expect(() => buildNativePlanPreview(hub.read(projectId), plan.id, proposed.revision))
        .toThrow(/revision/)
      const preview = buildNativePlanPreview(hub.read(projectId), plan.id, approved.revision)
      expect(preview.approval).toBe('accepted')
      const admission: AdaptiveRequest = {
        requestId: 'preview-once', scopeId: 'preview-grant',
        projectId, repoId: 'repo-one', hostId: 'local', baseSha: 'a'.repeat(40),
        planId: plan.id, planSha: preview.planSha,
        taskIds: preview.tasks.map((task) => task.id), operation: 'materialize_run'
      }
      const scope: AdaptiveScope = {
        projectId, repoId: admission.repoId, hostId: admission.hostId,
        baseSha: admission.baseSha, planId: admission.planId,
        planSha: admission.planSha, allowedTaskIds: admission.taskIds,
        operations: ['materialize_run'], maxOperations: 1,
        expiresAt: '2099-01-01T00:00:00Z'
      }
      const ledger = new HostAdmissionLedger(db)
      const materializer = new NativePlanMaterializer(db, ledger, {
        read: (id) => hub.read(id)
      })
      const request = { admission, expectedHubRevision: approved.revision, nowMs: now }
      expect(() => materializer.materialize(request)).toThrow(/unapproved_scope/)
      expect(db.listRuns().runs.filter((run) => run.legacy === 0)).toHaveLength(0)
      ledger.recordHostApproval(admission.scopeId, scope)
      const receipt = materializer.materialize(request)
      expect(receipt.dispatched).toBe(false)
      expect(Object.keys(receipt.tasks)).toHaveLength(preview.tasks.length)
      for (const task of preview.tasks) {
        const native = db.getTask(receipt.tasks[task.id])
        expect(native?.run_id).toBe(receipt.runId)
        expect(JSON.parse(native!.deps)).toEqual(task.dependsOn.map((id) => receipt.tasks[id]))
      }
      expect(db.db.prepare('SELECT COUNT(*) AS n FROM dispatch_contexts').get()).toMatchObject({ n: 0 })
      expect(db.db.prepare('SELECT COUNT(*) AS n FROM coordinator_runs').get()).toMatchObject({ n: 0 })
      expect(materializer.materialize(request)).toEqual(receipt)
      expect(db.listRuns().runs.filter((run) => run.legacy === 0)).toHaveLength(1)
    } finally {
      try {
        // ProjectHubStore writes restricted files synchronously but hardens the
        // enclosing directory asynchronously. Deleting before that finishes
        // produces a misleading Win32 ERROR_PATH_NOT_FOUND in the addon.
        const hardened = await __awaitPendingWindowsDirectoryHardeningForTests()
        expect(hardened).toBe(true)
        if (process.platform === 'win32') {
          expect(await restrictWindowsDirectory(join(root, 'project-hub', 'v1'))).toBe(true)
        }
      } finally {
        db.close()
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }
  })

  it('rejects stale revision and invalid plan identity without side effects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-preview-invalid-'))
    try {
      const hub = new ProjectHubStore(root)
      const projectId = 'repo:preview-invalid'
      const proposed = hub.save(projectId, {
        ...hub.read(projectId),
        intelligence: { ...emptyHubIntelligence(), plans: [plan] }
      }, 0)
      expect(() => buildNativePlanPreview(hub.read(projectId), 'missing-plan', proposed.revision))
        .toThrow(/Plan missing/)
      expect(() => buildNativePlanPreview(hub.read(projectId), plan.id, -1))
        .toThrow(/revision/)
      expect(() => buildNativePlanPreview(hub.read(projectId), 'bad/id', proposed.revision))
        .toThrow(/Invalid plan/)
    } finally {
      try {
        const hardened = await __awaitPendingWindowsDirectoryHardeningForTests()
        expect(hardened).toBe(true)
        if (process.platform === 'win32') {
          expect(await restrictWindowsDirectory(join(root, 'project-hub', 'v1'))).toBe(true)
        }
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }
  })
})
