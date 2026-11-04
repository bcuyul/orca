// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyProjectHub } from '../../../../shared/project-hub-types'
import { emptyHubIntelligence } from '../../../../shared/project-hub-intelligence'
import ProjectHubMathPreview from './ProjectHubMathPreview'

afterEach(cleanup)

function acceptedDocument() {
  const doc = emptyProjectHub('repo:ui-test')
  doc.intelligence = {
    ...emptyHubIntelligence(),
    plans: [{
      id: 'plan-ui', objective: 'Validate the manual MCDA decision interface',
      rationale: 'One human-approved synthetic task in a bounded DAG',
      source: 'human' as const, createdAt: '2026-11-04T12:00:00Z',
      tasks: [{
        id: 'forge-ui-01', title: 'Write a documented test case', role: 'forge' as const,
        dependsOn: [], acceptance: 'The test case documents the result'
      }]
    }],
    decisions: [{
      id: 'decision-ui', subject: 'plan' as const, subjectId: 'plan-ui',
      verdict: 'accepted' as const, justification: 'Human accepted the test scenario',
      createdAt: '2026-11-04T12:01:00Z'
    }]
  }
  return doc
}

function expand(): void {
  fireEvent.click(screen.getByText(/Optimización matemática · MCDA/))
}

function setValue(label: string, value: string): void {
  fireEvent.change(screen.getByRole('spinbutton', { name: label }), {
    target: { value }
  })
}

describe('Project Hub mathematical scenario UI', () => {
  it('keeps unapproved projects inert', () => {
    render(<ProjectHubMathPreview doc={emptyProjectHub('repo:empty')}/>)
    expand()
    expect(screen.getByText(/Aprueba manualmente un plan/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Calcular escenario/ })).toBeNull()
  })

  it('refuses implicit weights, then explains a calculated scenario as non-executable', () => {
    const doc = acceptedDocument()
    const before = JSON.stringify(doc)
    render(<ProjectHubMathPreview doc={doc}/>)
    expand()
    const calculate = screen.getByRole('button', { name: /Calcular escenario/ })
    fireEvent.click(calculate)
    expect(screen.getByRole('alert')).toHaveTextContent(/Completa todas las estimaciones/)
    setValue('Swing Valor usuario (0–100)', '100')
    setValue('Swing Desbloqueo (0–100)', '60')
    setValue('Swing Urgencia (0–100)', '40')
    setValue('Presupuesto de esfuerzo', '1')
    setValue('forge-ui-01 Valor usuario', '80')
    setValue('forge-ui-01 Desbloqueo', '20')
    setValue('forge-ui-01 Urgencia', '40')
    setValue('forge-ui-01 Esfuerzo', '1')
    fireEvent.click(calculate)
    expect(screen.getByText(/Resultado matemático del escenario/)).toBeInTheDocument()
    expect(screen.getByText(/No se admite ninguna tarea a ejecución/)).toBeInTheDocument()
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('does not leak scenario inputs across projects', () => {
    const first = acceptedDocument()
    const { rerender } = render(<ProjectHubMathPreview doc={first}/>)
    expand()
    setValue('Swing Valor usuario (0–100)', '100')
    expect(screen.getByRole('spinbutton', { name: 'Swing Valor usuario (0–100)' }))
      .toHaveValue(100)
    rerender(<ProjectHubMathPreview doc={emptyProjectHub('repo:other')}/>)
    expect(screen.getByText(/Aprueba manualmente un plan/)).toBeInTheDocument()
    rerender(<ProjectHubMathPreview doc={{ ...first, projectId: 'repo:next' }}/>)
    expect(screen.getByRole('spinbutton', { name: 'Swing Valor usuario (0–100)' }))
      .toHaveValue(null)
  })
})
