import { describe, expect, it } from 'vitest'
import {
  capturePersistedUIWriteBaseline,
  diffPersistedUIWriteFields
} from './persisted-ui-write-baseline'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'

describe('right sidebar navigation during persisted UI broadcasts', () => {
  it('keeps a user-selected Project Hub tab when a resize sync delivers stale Explorer', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'explorer',
      rightSidebarWidth: 350
    }), 'startup')
    // The user selected Project Hub after startup. The delayed persistence
    // writer has not yet acknowledged this edit (route request #8).
    store.setState({ rightSidebarTab: 'project-hub', rightSidebarRouteRequestId: 8 })
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'explorer',
      rightSidebarWidth: 470
    }), 'sync')

    const state = store.getState()
    expect(state.rightSidebarTab).toBe('project-hub')
    expect(state.rightSidebarRouteRequestId).toBe(8)
    expect(state.rightSidebarWidth).toBe(470)
    // Keep the old authoritative baseline so the local navigation edit still
    // produces exactly one pending write rather than being silently dropped.
    expect(state.persistedUIWriteBaseline?.rightSidebarTab).toBe('explorer')
    const dirty = diffPersistedUIWriteFields(
      capturePersistedUIWriteBaseline(state),
      state.persistedUIWriteBaseline!
    )
    expect(dirty.rightSidebarTab).toBe('project-hub')
  })

  it('ignores an unrelated Explorer sync without echoing an already saved Project Hub route', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'project-hub',
      rightSidebarExplorerView: 'files'
    }), 'startup')
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'search',
      rightSidebarWidth: 520
    }), 'sync')

    const state = store.getState()
    expect(state.rightSidebarTab).toBe('project-hub')
    expect(state.rightSidebarExplorerView).toBe('files')
    expect(state.rightSidebarWidth).toBe(520)
    expect(state.persistedUIWriteBaseline?.rightSidebarTab).toBe('project-hub')
    const dirty = diffPersistedUIWriteFields(
      capturePersistedUIWriteBaseline(state),
      state.persistedUIWriteBaseline!
    )
    expect(dirty.rightSidebarTab).toBeUndefined()
    expect(dirty.rightSidebarExplorerView).toBeUndefined()
  })

  it('preserves an intentionally selected Explorer search view across a stale sync', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'project-hub'
    }), 'startup')
    store.setState({
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'search',
      rightSidebarRouteRequestId: 9
    })
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'project-hub',
      rightSidebarExplorerView: 'files'
    }), 'sync')

    expect(store.getState().rightSidebarTab).toBe('explorer')
    expect(store.getState().rightSidebarExplorerView).toBe('search')
    expect(store.getState().rightSidebarRouteRequestId).toBe(9)
  })

  it('still restores a persisted sidebar route at startup', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({
      rightSidebarTab: 'source-control'
    }), 'startup')
    expect(store.getState().rightSidebarTab).toBe('source-control')
  })
})
