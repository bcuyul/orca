# PR #45 — permiso de un turno para worker de Project Hub (host-only)

## Objetivo

Reconciliar el permiso duradero `HostExecutionPermitStore` que ya existe en
`main` con un Run/Task **real** materializado desde Project Hub. Conservar
las barreras del proyecto hasta que haya infraestructura verificable para
ejecutar una sesión CLI.

## Qué hace realmente

`prepareHubOneWorkerPermit` (módulo de Electron main, **sin IPC expuesto**):

1. Revalida plan aprobado, revisión, hash, Project.id, repo, host y Git HEAD.
2. Reconciliación host-only del recibo del Run/Task nativo de SQLite.
3. Solo selecciona **una tarea raíz** que no dependa de tareas sin finalizar.
4. Exige evidencia de **sandbox OS realmente implementado y validado**.
   Un worktree Git sin aislamiento de procesos/red/archivos siempre falla.
5. Solicita decisión **independiente** de ejecutar un turno, suministrada
   por la ventana de host autenticada. La aprobación del plan no sirve.
6. Vuelve a leer Git/plan/Run después de la confirmación.
7. Reserva `agent_turn` con `maxOperations=1` en el ledger nativo, con
   identidad inmutable de Run/Task/worktree/SHA y expiración acotada.
8. Usa `HostExecutionPermitStore.prepare`, con idempotencia y recibo
   duradero; no ejecuta Dispatch.
9. Repeticiones con la misma identidad reutilizan el ticket; los estados
   inciertos o concesiones sueltas requieren conciliación, nunca retry ciego.

## Límites esenciales

**No hay proveedor de sandbox real conectado a este módulo y no hay IPC nuevo.**
Las pruebas usan una evidencia sandbox sintética, explícitamente solo en
`*.test.ts`. Este PR no habilita ejecución de modelos en la app actual,
no consume tokens y no pretende que un worktree equivalga a aislamiento OS.

Un límite de **un turno** no limita realmente el número de tokens ni la
factura dentro de ese turno. La cuota del proveedor y los topes efectivos
de costo deben acreditarse en el sender nativo antes de cualquier arranque.

Ninguna escritura a `tasks.spec`, `dispatch_contexts`, procesos, shells,
worktrees, redes, push, merge o deployment. El trigger persistente
`adaptive_staged_not_authorized` sigue activo.

## Criterios de integración

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/host-worker-permit-gate.test.ts
pnpm exec oxlint src/main/project-hub/host-worker-permit-gate.ts src/main/project-hub/host-worker-permit-gate.test.ts
pnpm typecheck
```

CI Windows/Ubuntu + Electron smoke antes de merge.

## Siguiente corte para ejecutar un worker real

- Implementar/confirmar sandbox OS por host (Windows y Linux) y acoplarlo a
  la creación de sesión, no solo al preflight.
- Agregar origen de consentimiento de ventana host y selector CLI con sesión
  autenticada; no aceptar `approved=true` desde renderer.
- Consumir permiso y crear Dispatch **en una transacción SQLite** con identidad
  de terminal/proceso, de forma idempotente; evitar cualquier instante en que
  el Coordinator genérico pueda despachar staged Tasks.
- Vincular cuotas reales, límite de gasto y cancelación; estado `unknown`
  no debe liberar presupuesto automáticamente.
- Probar un worker en laboratorio y su evidencia real antes de automatizar QA,
  PR y replanificación.

No reaplicar la rama experimental Draft #12. El nuevo módulo apunta a `main`.
