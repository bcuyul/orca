/** Repository-reviewed, non-sensitive knowledge. Shared between projects by Git revision,
 * never by reading other projects' private memories. */
export type HubSharedSkill = {
  id: string
  title: string
  when: string
  lesson: string
  evidence: readonly string[]
  keywords: readonly string[]
}
export const HUB_SHARED_SKILLS: readonly HubSharedSkill[] = [
  {
    id: 'windows-sqlite-test-cleanup-v1',
    title: 'Windows SQLite test fixture cleanup',
    when: 'Windows Vitest suites using temporary journal SQLite databases',
    lesson: 'Close the test journal connection before removing a temporary directory. ' +
      'Unclosed SQLite handles may keep .db, -wal or -shm files locked with EBUSY.',
    evidence: [
      'src/main/runtime/rpc/methods/agent-launch-replay.test.ts',
      'src/main/runtime/rpc/methods/agent-launch-prestart-failure.test.ts',
      'src/main/native-chat/agent-session-journal/journal-host-database-test-support.ts'
    ],
    keywords: ['sqlite', 'ebusy', 'windows', 'journal', 'vitest']
  }
]

/** Opt-in, keyword-based repository knowledge retrieval; no cross-project private-data leakage. */
export function retrieveHubSharedSkills(query: string, limit = 3): HubSharedSkill[] {
  const words = new Set(query.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  return HUB_SHARED_SKILLS.filter(skill =>
    skill.keywords.some(keyword => words.has(keyword))).slice(0, Math.max(0, Math.min(5, limit)))
}
