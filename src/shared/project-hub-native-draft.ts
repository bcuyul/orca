/** Pure preview. A draft never grants execution authority or asserts host provenance. */
import type { HubDocument } from './project-hub-types'
import { hubAgentSoul } from './project-hub-agent-profiles'
import { renderAtlasPlanningPrompt, renderQaReviewPrompt } from './project-hub-intelligence-prompts'

export type HubNativeTarget =
  | { kind: 'atlas'; blockerId?: string }
  | { kind: 'forge'; planId: string; taskId: string; baseSha: string }
  | { kind: 'qa'; planId: string; taskId: string; reportId: string }
export type HubNativeDraft = {
  prompt: string
  executionAuthorized: false
  autoSubmit: false
}
const sha = /^[a-f0-9]{40}$/i
const quote = (value: string): string =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')

export function buildHubNativeDraft(doc: HubDocument, target: HubNativeTarget): HubNativeDraft {
  const intelligence = doc.intelligence
  let prompt: string
  if (target.kind === 'atlas') {
    const blocker = target.blockerId
      ? intelligence?.blockers.find(b => b.id === target.blockerId) : undefined
    if (target.blockerId && !blocker) { throw new Error('Bloqueo inexistente') }
    const previous = blocker
      ? intelligence?.plans.find(p => p.id === blocker.planId) : undefined
    if (blocker && !previous) { throw new Error('Plan de bloqueo inexistente') }
    prompt = renderAtlasPlanningPrompt(doc, previous, blocker)
  } else {
    const plan = intelligence?.plans.find(p => p.id === target.planId)
    const task = plan?.tasks.find(t => t.id === target.taskId)
    const accepted = intelligence?.decisions.some(d => d.subject === 'plan' &&
      d.subjectId === target.planId && d.verdict === 'accepted') === true
    if (!plan || !task || !accepted || !['forge', 'flow', 'data'].includes(task.role)) {
      throw new Error('Se requiere un plan aprobado y una tarea de implementación')
    }
    if (target.kind === 'qa') {
      const report = intelligence?.implementations?.find(r => r.id === target.reportId)
      const latest = intelligence?.implementations?.findLast(r =>
        r.planId === plan.id && r.taskId === task.id)
      if (!report || report.planId !== plan.id || report.taskId !== task.id ||
        latest?.id !== report.id) {
        throw new Error('QA requiere la última entrega vinculada a esta tarea')
      }
      prompt = renderQaReviewPrompt(doc, plan, task.id, report.evidenceRef, report)
    } else {
      if (!sha.test(target.baseSha)) { throw new Error('SHA base inválido') }
      prompt = [
        '# Forge / Flow / Data: native Orca draft (manual submission required)',
        hubAgentSoul(task.role),
        'Project Hub does not grant access, permissions, worktrees or execution.',
        'Only act after the user explicitly sends this draft; obey native host permissions.',
        '<project-data>',
        `Project: ${quote(doc.projectId)}`,
        `Goal: ${quote(doc.blueprint.idea)}`,
        `Plan: ${quote(plan.id)}`,
        `Objective: ${quote(plan.objective)}`,
        `Task: ${quote(task.id)}`,
        `Title: ${quote(task.title)}`,
        `Acceptance: ${quote(task.acceptance)}`,
        `Dependencies: ${quote(task.dependsOn.join(', ') || '(none)')}`,
        `Declared base SHA (not verified for execution): ${quote(target.baseSha.toLowerCase())}`,
        '</project-data>',
        'Implement only this task within the authorized workspace. No secrets, merge, push or deployment.',
        'Return base/head SHAs, changed files, tests and failures for independent QA.',
        'An agent response or draft is not an authenticated Project Hub delivery receipt.'
      ].join('\n')
    }
  }
  if (!prompt.trim() || prompt.length > 30000) {
    throw new Error('El encargo debe contener 1–30000 caracteres')
  }
  return { prompt, executionAuthorized: false, autoSubmit: false }
}
