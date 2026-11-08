import { createHash } from 'node:crypto'
import { isHubDocument, type HubDocument } from '../../shared/project-hub-types'
import { isHubPlanProposal, type HubPlanProposal, type HubPlanTask } from '../../shared/project-hub-intelligence'
import type { NativePlanPreview } from '../../shared/native-plan-preview'

/** Stable dependency-first ordering; native createTask needs predecessor IDs. */
function orderedTasks(plan: HubPlanProposal): HubPlanTask[] {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]))
  const visited = new Set<string>()
  const ordered: HubPlanTask[] = []
  const visit = (id: string): void => {
    if (visited.has(id)) { return }
    const task = byId.get(id)
    if (!task) { throw new Error('Unknown plan dependency') }
    for (const dependency of [...task.dependsOn].sort()) { visit(dependency) }
    ordered.push(task)
    visited.add(id)
  }
  for (const task of [...plan.tasks].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    visit(task.id)
  }
  return ordered
}

/** The caller must supply a fresh document read from the trusted desktop ProjectHubStore. */
export function buildNativePlanPreview(
  document: HubDocument, planId: string, expectedRevision: number
): NativePlanPreview {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !isHubDocument(document) || document.revision !== expectedRevision) {
    throw new Error('Project Hub revision/identity mismatch')
  }
  if (typeof planId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(planId)) {
    throw new Error('Invalid plan ID')
  }
  const plan = document.intelligence?.plans.find((candidate) => candidate.id === planId)
  if (!plan || !isHubPlanProposal(plan)) { throw new Error('Plan missing or invalid') }
  const decision = document.intelligence?.decisions.find((candidate) =>
    candidate.subject === 'plan' && candidate.subjectId === planId)
  // Revocation applies only to memories; never let an extended union grant plan approval.
  const approval = decision?.verdict === 'accepted' || decision?.verdict === 'rejected'
    ? decision.verdict : 'pending'
  return {
    projectId: document.projectId, revision: document.revision,
    planId, planSha: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    objective: plan.objective, approval,
    tasks: orderedTasks(plan).map(({ id, title, role, acceptance, dependsOn }) => ({
      id, title, role, acceptance, dependsOn: [...dependsOn]
    })),
    dispatched: false
  }
}
