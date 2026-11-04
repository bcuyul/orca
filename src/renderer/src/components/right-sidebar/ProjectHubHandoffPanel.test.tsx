// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyProjectHub, type HubDocument } from '../../../../shared/project-hub-types'
import { emptyHubIntelligence } from '../../../../shared/project-hub-intelligence'
import ProjectHubHandoffPanel from './ProjectHubHandoffPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const local = {
  worktreeId: 'repo:lab::C:/lab', worktreePath: 'C:/lab', hostId: 'local'
}
function document(): HubDocument {
  const doc = emptyProjectHub('project:lab')
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-lab', objective: 'Document the Forge laboratory',
      rationale: 'Manual lab with independent review', source: 'human',
      createdAt: '2026-11-04T12:00:00Z',
      tasks: [{ id: 'forge-lab', title: 'Implement laboratory README', role: 'forge',
        dependsOn: [], acceptance: 'README diff reviewed independently' }]
    }],
    decisions: [{
      id: 'approve-lab', subject: 'plan', subjectId: 'plan-lab', verdict: 'accepted',
      justification: 'Human reviewed the lab DAG', createdAt: '2026-11-04T12:01:00Z'
    }]
  }
  return doc
}
function inspected(head: string) {
  return {
    status: { entries: [], conflictOperation: 'unknown', head, branch: 'lab/forge' },
    history: {
      currentRef: { id: 'refs/heads/lab/forge', name: 'lab/forge', revision: head },
      items: [{ id: head, parentIds: [], subject: 'README', message: 'README' }],
      hasIncomingChanges: false, hasOutgoingChanges: false, hasMore: false, limit: 1
    }
  }
}
function setSelection() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Plan para entrega Forge' }), {
    target: { value: 'plan-lab' }
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Tarea para entrega Forge' }), {
    target: { value: 'forge-lab' }
  })
}

describe('Project Hub assisted manual Git handoff', () => {
  it('reads native Git on explicit clicks, never writes or dispatches', async () => {
    const snapshot = inspected(BASE)
    const status = vi.fn().mockResolvedValue(snapshot.status)
    const history = vi.fn().mockResolvedValue(snapshot.history)
    Object.defineProperty(window, 'api', { configurable: true, value: { git: { status, history } } })
    const save = vi.fn(async (_doc: HubDocument) => true)
    render(<ProjectHubHandoffPanel doc={document()} busy={false}
      gitContext={local} onSave={save}/>)
    setSelection()
    const base = screen.getByRole('textbox', { name: 'SHA base de Forge' })
    const delivery = screen.getByRole('textbox', { name: 'SHA de entrega Forge' })
    expect(base).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: /Leer SHA base desde Git local/ }))
    await waitFor(() => expect(base).toHaveValue(BASE))
    expect(status).toHaveBeenCalledWith({
      worktreePath: 'C:/lab', admissionTier: 'interactive', wakeWslDistro: false
    })
    expect(history).toHaveBeenCalledWith({
      worktreePath: 'C:/lab', limit: 1, wakeWslDistro: false
    })
    status.mockResolvedValue(inspected(HEAD).status)
    history.mockResolvedValue(inspected(HEAD).history)
    fireEvent.click(screen.getByRole('button', { name: /Leer entrega desde Git local/ }))
    await waitFor(() => expect(delivery).toHaveValue(HEAD))
    expect((screen.getByRole('textbox', {
      name: 'Evidencia de Forge'
    }) as HTMLInputElement).value).toContain(HEAD)
    expect(screen.getByRole('button', { name: /Registrar entrega externa/ })).toBeDisabled()
    status.mockResolvedValue({
      ...inspected(HEAD).status, entries: [{ path: 'uncommitted-change.ts' }]
    })
    fireEvent.click(screen.getByRole('button', { name: /Leer entrega desde Git local/ }))
    await waitFor(() => expect(delivery).toHaveValue(''))
    expect(screen.getByRole('textbox', { name: 'Evidencia de Forge' })).toHaveValue('')
    expect(screen.getByText(/Inspección Git no disponible/)).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps manual fallback on remote hosts and refuses a dirty local snapshot', async () => {
    const dirty = inspected(BASE).status
    const status = vi.fn().mockResolvedValue({ ...dirty, entries: [{ path: 'README.md' }] })
    const history = vi.fn().mockResolvedValue(inspected(BASE).history)
    Object.defineProperty(window, 'api', { configurable: true, value: { git: { status, history } } })
    const save = vi.fn(async (_doc: HubDocument) => true)
    const { rerender } = render(<ProjectHubHandoffPanel doc={document()} busy={false}
      gitContext={local} onSave={save}/>)
    setSelection()
    fireEvent.click(screen.getByRole('button', { name: /Leer SHA base desde Git local/ }))
    await waitFor(() => expect(screen.getByText(/Inspección Git no disponible/)).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'SHA base de Forge' })).toHaveValue('')
    rerender(<ProjectHubHandoffPanel doc={document()} busy={false} onSave={save}
      gitContext={{ ...local, hostId: 'remote' }}/>)
    expect(screen.getByRole('button', { name: /Leer SHA base desde Git local/ })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'SHA base de Forge' })).toBeEnabled()
    expect(save).not.toHaveBeenCalled()
  })
})
