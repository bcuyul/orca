/** Bounded advisory lesson selection. No Hermes filesystem access or memory writes. */
import { isHubAgentProfile, type HubAgentProfile } from './project-hub-agent-profiles'
import { approvedHubMemories, isHubIntelligence, type HubIntelligence } from './project-hub-intelligence'

export type HubAttestedLesson = {
  id: string
  projectId: string
  profile: HubAgentProfile | 'all'
  keywords: string[]
  lesson: string
  /** User-supplied reference, NOT host-verified proof of a fix. */
  evidenceRef: string
  reviewedAt: string
  reviewedBy: 'human'
}

export const HUB_MEMORY_MAX_HINTS = 2
export const HUB_MEMORY_MAX_CHARS = 480
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000
const RECORD_LIMIT = 40
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const terms = (value: string): string[] =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []

/** Evidence is attested by a human, not automatically authenticated by Orca. */
export function isHubAttestedLesson(value: unknown): value is HubAttestedLesson {
  if (!record(value) || typeof value.id !== 'string' ||
      !/^[a-z0-9_-]{2,64}$/.test(value.id) ||
      typeof value.projectId !== 'string' ||
      value.projectId.length === 0 || value.projectId.length > 500 ||
      !(value.profile === 'all' || isHubAgentProfile(value.profile)) ||
      !Array.isArray(value.keywords) || value.keywords.length < 1 ||
      value.keywords.length > 8 ||
      value.keywords.some(word => typeof word !== 'string' ||
        !/^[a-zA-Z0-9_-]{3,32}$/.test(word)) ||
      typeof value.lesson !== 'string' || value.lesson.trim() !== value.lesson ||
      value.lesson.length < 8 || value.lesson.length > 220 ||
      [...value.lesson].some(char => char.charCodeAt(0) < 32 || char === '<' || char === '>') ||
      typeof value.evidenceRef !== 'string' ||
      !/^commit:[a-f0-9]{40}$/.test(value.evidenceRef) ||
      value.reviewedBy !== 'human' ||
      typeof value.reviewedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.reviewedAt)) {
    return false
  }
  return Number.isFinite(Date.parse(value.reviewedAt))
}

/** Relevance is lexical and predictable, never an LLM/semantic-confidence claim. */
export function selectHubTaskLessons(input: {
  lessons: readonly HubAttestedLesson[]
  projectId: string
  profile: HubAgentProfile
  taskText: string
  nowMs: number
}): HubAttestedLesson[] {
  const { lessons, projectId, profile, taskText, nowMs } = input
  if (!Array.isArray(lessons) || lessons.length > RECORD_LIMIT ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      typeof taskText !== 'string' || taskText.length > 16_000 ||
      typeof projectId !== 'string' || projectId.length === 0 ||
      !isHubAgentProfile(profile)) {
    throw new Error('invalid_task_memory_selection')
  }
  const ids = new Set<string>()
  for (const lesson of lessons) {
    if (!isHubAttestedLesson(lesson) || ids.has(lesson.id)) {
      throw new Error('invalid_attested_lesson')
    }
    ids.add(lesson.id)
  }
  const taskTerms = new Set(terms(taskText))
  const candidates = lessons.flatMap(lesson => {
    if (lesson.projectId !== projectId ||
        (lesson.profile !== 'all' && lesson.profile !== profile)) { return [] }
    const reviewed = Date.parse(lesson.reviewedAt)
    if (reviewed > nowMs || nowMs - reviewed > MAX_AGE_MS) { return [] }
    const matches = lesson.keywords.filter(keyword =>
      terms(keyword).some(term => taskTerms.has(term))).length
    return matches ? [{ lesson, matches, reviewed }] : []
  }).sort((a, b) => b.matches - a.matches ||
    b.reviewed - a.reviewed || a.lesson.id.localeCompare(b.lesson.id))
  const selected: HubAttestedLesson[] = []
  const seen = new Set<string>()
  let used = 0
  for (const { lesson } of candidates) {
    const fingerprint = lesson.lesson.toLowerCase()
    const length = lesson.lesson.length + lesson.evidenceRef.length + 6
    if (seen.has(fingerprint) || used + length > HUB_MEMORY_MAX_CHARS) { continue }
    seen.add(fingerprint)
    selected.push(lesson)
    used += length
    if (selected.length === HUB_MEMORY_MAX_HINTS) { break }
  }
  return selected
}

/**
 * Reuse Project Hub's existing durable candidate + human decision records.
 * Only explicit profile/tags metadata and commit references qualify.
 * This is a human attestation, NOT host-verified CI or Git proof.
 */
export function approvedHubTaskLessons(
  state: HubIntelligence | undefined,
  projectId: string
): HubAttestedLesson[] {
  if (!state) { return [] }
  if (!isHubIntelligence(state) || typeof projectId !== 'string' ||
      !projectId || projectId.length > 500) {
    throw new Error('invalid_project_memory_source')
  }
  const reviewedAt = new Map(state.decisions.filter(decision =>
    decision.subject === 'memory' && decision.verdict === 'accepted')
    .map(decision => [decision.subjectId, decision.createdAt]))
  const candidates = approvedHubMemories(state).flatMap(candidate => {
    // Older free-form applicability stays readable, but is not injected into prompts.
    const match = /^profile=(atlas|forge|flow|data|qa|all);tags=([a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+){0,7})$/
      .exec(candidate.applicability)
    const date = reviewedAt.get(candidate.id)
    if (!match || !date) { return [] }
    const record: HubAttestedLesson = {
      id: candidate.id, projectId,
      profile: match[1] as HubAttestedLesson['profile'],
      keywords: match[2].split(','),
      lesson: candidate.lesson,
      evidenceRef: candidate.evidenceRef,
      reviewedAt: date,
      reviewedBy: 'human'
    }
    return isHubAttestedLesson(record) ? [record] : []
  })
  // The selector admits up to 40 records. Prefer the most recently approved
  // and keep ordering deterministic even if old projects have 100 candidates.
  return candidates.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) ||
    a.id.localeCompare(b.id)).slice(0, RECORD_LIMIT)
}
