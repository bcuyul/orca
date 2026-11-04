// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyProjectHub } from '../../../../shared/project-hub-types'
import ProjectHubNativeDraftPanel from './ProjectHubNativeDraftPanel'

const mocks = vi.hoisted(() => {
  const store = {
    activeWorktreeId: 'wt-lab',
    settings: { experimentalNativeChat: true, disabledTuiAgents: [] as string[] },
    localDetectedAgentIdsByContext: {},
    isDetectingLocalAgentsByContext: {},
    isRefreshingLocalAgentsByContext: {},
    ensureDetectedAgents: vi.fn(),
    readLocalAgentInventory: vi.fn(() => ({ ids: ['codex' as const], state: 'successful' as const }))
  }
  return { store, launch: vi.fn(), feasible: vi.fn(() => true) }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (select: (state: typeof mocks.store) => unknown) => select(mocks.store),
    { getState: () => mocks.store }
  )
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launch }))
vi.mock('@/lib/agent-session-launch-plan', () => ({
  structuredAgentSessionLaunchFeasible: mocks.feasible
}))
vi.mock('@/lib/agent-launch-route-input', () => ({
  worktreeLaunchWorkspace: (worktreeId: string) => ({ kind: 'git-worktree', worktreeId })
}))
vi.mock('@/lib/agent-launch-request-id', () => ({
  newAgentLaunchRequestId: () => 'request-lab'
}))
const gitContext = { worktreeId: 'wt-lab', worktreePath: 'C:/lab', hostId: 'local' }
afterEach(() => {
  cleanup()
  mocks.launch.mockReset()
  mocks.feasible.mockReturnValue(true)
  mocks.store.activeWorktreeId = 'wt-lab'
})
describe('Project Hub native draft launch', () => {
  it('prepares native chat as draft, with no auto-send or terminal fallback', () => {
    mocks.launch.mockReturnValue({ surface: { kind: 'local-chat', tabId: 'tab-1' },
      pasteDraftAfterLaunch: false })
    render(<ProjectHubNativeDraftPanel doc={emptyProjectHub('project:lab')}
      gitContext={gitContext}/>)
    const button = screen.getByRole('button', { name: 'Abrir borrador en chat nativo' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    fireEvent.click(button)
    expect(mocks.launch).toHaveBeenCalledTimes(1)
    const args = mocks.launch.mock.calls[0]![0]
    expect(args).toEqual(expect.objectContaining({
      agent: 'codex', worktreeId: 'wt-lab',
      requestedSurface: 'chat', promptDelivery: 'draft'
    }))
    expect(args.prompt).toContain('Atlas: propose a plan')
    expect(args.onStructuredHostDeclined()).toEqual({ opened: false })
    expect(screen.getByRole('button', { name: /Coordinator:/ })).toBeDisabled()
  })
  it('refuses remote host, switched worktree and unsupported native chat', () => {
    const { rerender } = render(<ProjectHubNativeDraftPanel
      doc={emptyProjectHub('project:lab')} gitContext={{ ...gitContext, hostId: 'ssh:lab' }}/>)
    expect(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' })).toBeDisabled()
    rerender(<ProjectHubNativeDraftPanel doc={emptyProjectHub('project:lab')}
      gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    mocks.store.activeWorktreeId = 'wt-foreign'
    fireEvent.click(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    expect(mocks.launch).not.toHaveBeenCalled()
    mocks.store.activeWorktreeId = 'wt-lab'
    mocks.feasible.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('invalidates human review when the project revision changes', async () => {
    const doc = emptyProjectHub('project:lab')
    const { rerender } = render(<ProjectHubNativeDraftPanel doc={doc}
      gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    const button = screen.getByRole('button', { name: 'Abrir borrador en chat nativo' })
    expect(button).toBeEnabled()
    rerender(<ProjectHubNativeDraftPanel doc={{ ...doc, revision: 1 }}
      gitContext={gitContext}/>)
    await waitFor(() => expect(button).toBeDisabled())
    expect(mocks.launch).not.toHaveBeenCalled()
  })

})
