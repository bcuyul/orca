import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { emptyProjectHub } from '../../shared/project-hub-types'
import { emptyHubIntelligence, type HubPlanProposal } from '../../shared/project-hub-intelligence'
import { buildNativePlanPreview } from './native-plan-preview'
import {
  stageHubNativePlan, type HubStageHostDependencies
} from './supervised-native-plan-stage'

const dbs: OrchestrationDb[] = []
afterEach(() => { for (const db of dbs.splice(0)) { db.close() } })

const plan: HubPlanProposal = {
  id: 'plan-demo', source: 'atlas-proposal',
  objective: 'Test supervised native DAG materialization',
  rationale: 'Exercise a real Run/Task without any agent dispatch',
  createdAt: '2026-11-06T10:00:00Z', tasks: [
    { id: 'qa', title: 'Check implementation', role: 'qa',
      dependsOn: ['forge'], acceptance: 'Review diff independently' },
    { id: 'forge', title: 'Implement small feature', role: 'forge',
      dependsOn: [], acceptance: 'Tests pass' }
  ]
}

function harness() {
  const projectId = 'repo:test'
  const doc = {
    ...emptyProjectHub(projectId), revision: 2,
    intelligence: {
      ...emptyHubIntelligence(), plans: [plan],
      decisions: [{ id: 'decision-one', subject: 'plan' as const,
        subjectId: plan.id, verdict: 'accepted' as const,
        justification: 'Reviewed the DAG and limits',
        createdAt: '2026-11-06T10:01:00Z' }]
    }
  }
  const db = new OrchestrationDb(':memory:')
  dbs.push(db)
  const inspect = vi.fn(async () => ({
    worktreeId: 'worktree-lab', repoId: 'repo-test',
    projectId, hostId: 'local', baseSha: 'a'.repeat(40)
  }))
  const confirm = vi.fn(async () => true)
  const host: HubStageHostDependencies = {
    readProject: () => doc,
    inspectWorktree: inspect,
    confirmInHostWindow: confirm,
    getOrchestrationDb: () => db
  }
  const preview = buildNativePlanPreview(doc, plan.id, doc.revision)
  const request = {
    projectId, planId: plan.id, expectedRevision: doc.revision,
    planSha: preview.planSha, worktreeId: 'worktree-lab'
  }
  return { doc, db, host, inspect, confirm, request }
}

describe('Project Hub supervised native Run/Task stage', () => {
  it('requires a separate host consent and keeps a cancelled request side-effect-free', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(false)
    expect(await stageHubNativePlan(h.request, h.host)).toEqual({ status: 'cancelled' })
    expect(h.db.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(0)
    expect(h.confirm).toHaveBeenCalledOnce()
  })

  it('creates one durable Run with DAG dependencies, never a dispatch or coordinator', async () => {
    const h = harness()
    const first = await stageHubNativePlan(h.request, h.host)
    expect(first).toMatchObject({ status: 'staged', planId: plan.id,
      reused: false, dispatched: false })
    if (first.status !== 'staged') { throw new Error('Expected stage receipt') }
    expect(Object.keys(first.tasks)).toHaveLength(2)
    const qa = h.db.getTask(first.tasks.qa!)
    expect(qa?.run_id).toBe(first.runId)
    expect(JSON.parse(qa!.deps)).toEqual([first.tasks.forge])
    expect(h.db.db.prepare('SELECT COUNT(*) AS count FROM dispatch_contexts').get())
      .toMatchObject({ count: 0 })
    expect(h.db.db.prepare('SELECT COUNT(*) AS count FROM coordinator_runs').get())
      .toMatchObject({ count: 0 })

    const second = await stageHubNativePlan(h.request, h.host)
    expect(second).toEqual({ ...first, reused: true })
    expect(h.db.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(1)
    expect(h.inspect).toHaveBeenCalledTimes(4)
  })

  it('rejects forged plan approval, stale revisions and mismatched host worktrees', async () => {
    const h = harness()
    await expect(stageHubNativePlan({ ...h.request, planSha: '0'.repeat(64) }, h.host))
      .rejects.toThrow(/approved plan SHA/)
    await expect(stageHubNativePlan({ ...h.request, expectedRevision: 1 }, h.host))
      .rejects.toThrow(/revision/)
    h.inspect.mockResolvedValueOnce({
      worktreeId: 'worktree-lab', repoId: 'repo-test',
      projectId: 'other-project', hostId: 'local', baseSha: 'a'.repeat(40)
    })
    await expect(stageHubNativePlan(h.request, h.host)).rejects.toThrow(/cannot be verified/)
    expect(h.db.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(0)
  })

  it('rejects a host Git HEAD switch after native consent with zero persisted tasks', async () => {
    const h = harness()
    h.inspect.mockResolvedValueOnce({
      worktreeId: 'worktree-lab', repoId: 'repo-test',
      projectId: h.request.projectId, hostId: 'local', baseSha: 'a'.repeat(40)
    }).mockResolvedValueOnce({
      worktreeId: 'worktree-lab', repoId: 'repo-test',
      projectId: h.request.projectId, hostId: 'local', baseSha: 'b'.repeat(40)
    })
    await expect(stageHubNativePlan(h.request, h.host))
      .rejects.toThrow(/changed while confirming/)
    expect(h.db.listRuns().runs.filter(row => row.legacy === 0)).toHaveLength(0)
  })
})
