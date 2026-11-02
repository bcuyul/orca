/** Illustrative, synthetic values only: neither costs nor success probabilities measured on Orca. */
export const fixture = {
  budget: 11,
  weights: { user: 0.5, unlock: 0.3, urgency: 0.2 },
  tasks: [
    { id: 'A', title: 'Disponibilidad y datos', user: 8, unlock: 10, urgency: 7, pSuccess: 0.85, effort: 3, dependsOn: [], mandatory: true, role: 'data' },
    { id: 'B', title: 'Crear reserva', user: 10, unlock: 9, urgency: 8, pSuccess: 0.9, effort: 4, dependsOn: ['A'], mandatory: true, role: 'forge' },
    { id: 'C', title: 'Cancelar reserva', user: 7, unlock: 4, urgency: 4, pSuccess: 0.8, effort: 2, dependsOn: ['B'], role: 'forge' },
    { id: 'D', title: 'Tema visual', user: 4, unlock: 2, urgency: 2, pSuccess: 0.9, effort: 2, dependsOn: [], role: 'forge' },
    { id: 'E', title: 'Notificaciones', user: 6, unlock: 2, urgency: 3, pSuccess: 0.7, effort: 3, dependsOn: ['B'], role: 'flow' },
    { id: 'F', title: 'Autenticación', user: 8, unlock: 5, urgency: 5, pSuccess: 0.85, effort: 3, dependsOn: [], role: 'forge' }
  ]
}
