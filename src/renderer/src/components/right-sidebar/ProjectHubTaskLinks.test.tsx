// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyProjectHub } from '../../../../shared/project-hub-types'
import type { HubDocument } from '../../../../shared/project-hub-types'
import { emptyHubIntelligence } from '../../../../shared/project-hub-intelligence'
import ProjectHubTaskLinks from './ProjectHubTaskLinks'

afterEach(cleanup)

function docForLab(): HubDocument {
  const doc = emptyProjectHub('project:ui-lab')
  doc.items = [{
    id: 'PH-001', title: 'Trace Forge and QA', type: 'story', status: 'ready',
    phase: 1, source: 'local', acceptance: 'Keep audit linked', description: ''
  }]
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{ id: 'plan-ui', objective: 'Verify project task linkage',
      rationale: 'Human reviews a small DAG before associating stories',
      source: 'human', createdAt: '2026-11-04T12:00:00Z',
      tasks: [{ id: 'forge-ui', title: 'Document traceable work',
        role: 'forge', dependsOn: [], acceptance: 'Diff can be inspected' }] }],
    decisions: [{ id: 'accept-ui', subject: 'plan', subjectId: 'plan-ui',
      verdict: 'accepted', justification: 'Approved a controlled laboratory DAG',
      createdAt: '2026-11-04T12:01:00Z' }]
  }
  return doc
}

describe('Project Hub backlog to DAG linkage form', () => {
  it('requires approved plans and does not offer autonomous execution', () => {
    render(<ProjectHubTaskLinks doc={emptyProjectHub('project:empty')}
      busy={false} onSave={vi.fn(async () => true)} />)
    expect(screen.getByText(/Aprueba un plan de Atlas/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar vínculo/ })).toBeNull()
  })

  it('records a user-selected audited story link without modifying backlog state', async () => {
    const doc = docForLab()
    const saved = vi.fn(async (_next: HubDocument) => true)
    const snapshot = JSON.stringify(doc)
    render(<ProjectHubTaskLinks doc={doc} busy={false} onSave={saved} />)
    const button = screen.getByRole('button', { name: /Registrar vínculo/ })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Historia para forge-ui' }), {
      target: { value: 'PH-001' }
    })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    const next = saved.mock.calls[0]![0]
    expect(next.taskLinks?.[0]).toMatchObject({
      planId: 'plan-ui', taskId: 'forge-ui', storyId: 'PH-001'
    })
    expect(next.items[0]?.status).toBe('ready')
    expect(JSON.stringify(doc)).toBe(snapshot)
  })
})
