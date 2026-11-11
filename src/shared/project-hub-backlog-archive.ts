import type { HubDocument, HubItem } from './project-hub-types'

/**
 * A "remove" action is reversible: story IDs and backlinks stay intact.
 * This function changes exactly one archived flag, never plans or evidence.
 */
export function setHubBacklogItemArchived(
  document: HubDocument,
  itemId: string,
  archived: boolean
): HubDocument {
  const item = document.items.find(row => row.id === itemId)
  if (!item) { throw new Error('No existe el elemento del Backlog.') }
  if (archived && !['backlog', 'ready'].includes(item.status)) {
    throw new Error('Solo se pueden quitar elementos en Backlog o Ready.')
  }
  if (!!item.archived === archived) {
    throw new Error(archived ? 'El elemento ya fue quitado.' : 'El elemento no está archivado.')
  }
  return {
    ...document,
    items: document.items.map(row => row.id === itemId
      ? { ...row, archived }
      : row)
  }
}

/** Host-side append-only identity fence: previously saved IDs cannot disappear. */
export function preservesHubBacklogItemIdentities(
  before: readonly HubItem[],
  after: readonly HubItem[]
): boolean {
  const ids = new Set(after.map(row => row.id))
  return before.every(row => ids.has(row.id))
}
