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
  return { store, launch: vi.fn(), feasible: vi.fn(() => true),
    readSession: vi.fn(), activateSession: vi.fn(() => true) }
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
vi.mock('@/lib/project-hub-host-session-reader', () => ({
  readHubLocalSessionInventory: mocks.readSession
}))
vi.mock('@/lib/agent-session/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.activateSession
}))
const gitContext = { worktreeId: 'wt-lab', worktreePath: 'C:/lab', hostId: 'local' }
afterEach(() => {
  cleanup()
  mocks.launch.mockReset()
  mocks.readSession.mockReset()
  mocks.activateSession.mockClear()
  mocks.activateSession.mockReturnValue(true)
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

  it('navigates only after structured settlement and host reconciliation', async () => {
    mocks.launch.mockReturnValue({
      surface: { kind: 'local-chat', tabId: 'agent-session:codex_123_456' },
      pasteDraftAfterLaunch: false,
      structuredSettlement: Promise.resolve({ kind: 'structured', sessionId: 'codex_123_456' })
    })
    mocks.readSession.mockResolvedValue({
      kind: 'confirmed', worktreeId: 'wt-lab', agent: 'codex',
      sessionId: 'codex_123_456', tabId: 'agent-session:codex_123_456',
      source: 'host-inventory', executionAuthorized: false
    })
    render(<ProjectHubNativeDraftPanel doc={emptyProjectHub('project:lab')}
      gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    const open = await screen.findByRole('button', { name: 'Comprobar y abrir chat existente' })
    fireEvent.click(open)
    await waitFor(() => expect(mocks.activateSession).toHaveBeenCalledWith({
      worktreeId: 'wt-lab', tabId: 'agent-session:codex_123_456', target: { kind: 'local' }
    }))
    expect(mocks.readSession).toHaveBeenCalledWith({
      sessionId: 'codex_123_456', agent: 'codex', worktreeId: 'wt-lab'
    })
    expect(mocks.launch).toHaveBeenCalledTimes(1)
  })

  it('does not navigate on uncertain inventory or uncertain launch', async () => {
    mocks.launch.mockReturnValue({
      surface: { kind: 'host-published' }, pasteDraftAfterLaunch: false,
      structuredSettlement: Promise.resolve({ kind: 'structured', sessionId: 'codex_123_456' })
    })
    mocks.readSession.mockResolvedValue({
      kind: 'reconcile-first', reason: 'Host inventory not authoritative',
      executionAuthorized: false
    })
    const { unmount } = render(<ProjectHubNativeDraftPanel
      doc={emptyProjectHub('project:lab')} gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Comprobar y abrir chat existente' }))
    await waitFor(() => expect(mocks.readSession).toHaveBeenCalledOnce())
    expect(mocks.activateSession).not.toHaveBeenCalled()
    unmount()

    mocks.launch.mockReturnValue({
      surface: { kind: 'host-published' }, pasteDraftAfterLaunch: false,
      structuredSettlement: Promise.resolve({ kind: 'visibility-unknown', sessionId: 'codex_123_456' })
    })
    render(<ProjectHubNativeDraftPanel
      doc={emptyProjectHub('project:lab')} gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/incierto/))
    expect(screen.queryByRole('button', { name: 'Comprobar y abrir chat existente' }))
      .not.toBeInTheDocument()
    expect(mocks.activateSession).not.toHaveBeenCalled()
  })

  it('blocks a second launch when its receipt is uncertain, then reconciles without replay', async () => {
    mocks.launch.mockReturnValue({
      surface: { kind: 'host-published' }, pasteDraftAfterLaunch: false,
      structuredSettlement: Promise.resolve({
        kind: 'visibility-unknown', sessionId: 'codex_123_456'
      })
    })
    mocks.readSession.mockResolvedValueOnce({
      kind: 'confirmed', sessionId: 'codex_123_456', agent: 'codex',
      worktreeId: 'wt-lab', tabId: 'agent-session:codex_123_456',
      source: 'host-inventory', executionAuthorized: false
    })
    render(<ProjectHubNativeDraftPanel doc={emptyProjectHub('project:lab')}
      gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    const start = screen.getByRole('button', { name: 'Abrir borrador en chat nativo' })
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/incierto/))
    expect(start).toBeDisabled()
    fireEvent.click(start)
    expect(mocks.launch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar y abrir chat existente' }))
    await waitFor(() => expect(mocks.activateSession).toHaveBeenCalledOnce())
    expect(mocks.readSession).toHaveBeenCalledOnce()
    expect(mocks.launch).toHaveBeenCalledTimes(1)
  })

  it('blocks new launches when the host returned no settlement identity', async () => {
    mocks.launch.mockReturnValue({
      surface: { kind: 'host-published' }, pasteDraftAfterLaunch: false
    })
    render(<ProjectHubNativeDraftPanel doc={emptyProjectHub('project:lab')}
      gitContext={gitContext}/>)
    fireEvent.change(screen.getByRole('combobox', { name: /Agente detectado/ }), {
      target: { value: 'codex' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el encargo/ }))
    const start = screen.getByRole('button', { name: 'Abrir borrador en chat nativo' })
    fireEvent.click(start)
    expect(start).toBeDisabled()
    expect(mocks.launch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Comprobar y abrir chat existente' }))
      .not.toBeInTheDocument()
  })

})
