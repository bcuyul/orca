# PR #47 — recuperación conservadora de Dispatch (solo lectura)

## Motivación

El PR #46 puede reservar en SQLite un `Dispatch` desde un permiso independiente
en una transacción atómica. Su recibo tiene `workerStarted: false` y
`modelCalls: 0` **en el momento de la reserva**. Tras un reinicio no podemos
inferir si un futuro sender llegó a entregar el prompt. Volver a enviarlo
automáticamente duplicaría el turno y el consumo de cuota.

## Implementación

`inspectHubWorkerDispatches(db, identity)`:

- Lee únicamente tablas nativas de Orca: grants/admissions/permits, claims,
  Run, Task y Dispatch; no instancia `HostAdmissionLedger`, cuyo constructor
  crearía triggers/tablas.
- Selecciona por proyecto/repo/host/plan SHA; filtra worktree concreto. La
  recuperación no se oculta al cambiar el HEAD de Git.
- Verifica correspondencia de IDs, alcance de un turno, permiso, recibo
  original, spec de Task y identidad autenticada de terminal.
- Distingue `not_found`, `reserved_unobserved`,
  `settled_unverified` y `needs_reconciliation`.
- Rechaza como divergente cualquier registro corrupto, permiso revocado o
  incoherencia en Task/Dispatch/terminal; limita la exploración a 100 claims.
- **Siempre** retorna `safeToResend:false`,
  `deliveryVerified:false` y `executionAuthorized:false`.

## Garantías y límites

Un `Dispatch` reservado es una **reserva**, no prueba de que un agente vio el
prompt. Un `Dispatch` finalizado en SQLite no acredita por sí solo QA
independiente ni un commit real. Por eso el reporte jamás autoriza
reenviar, reutilizar un turno o lanzar un segundo worker.

No hay IPC, UI, nuevos procesos ni comandos, no se cambia el ciclo de vida de
Tasks, ni hay conexiones a modelos. Este PR es el lector host-only que un futuro
panel de recuperación y sender podrán usar antes de cualquier acción.

**Nota de alcance:** la recuperación de registros con concesiones dañadas de
forma que ya no puedan relacionarse con un proyecto requiere auditoría global
por un administrador; la consulta del proyecto nunca asegura reintento.

## Pruebas sin tokens

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/host-worker-dispatch-recovery.test.ts
pnpm exec oxlint src/main/project-hub/host-worker-dispatch-recovery.ts src/main/project-hub/host-worker-dispatch-recovery.test.ts
pnpm typecheck
```

Las pruebas crean un DAG/Run/Task real en SQLite en memoria, registran permiso
y Dispatch con un terminal **falso solo en tests**, inspeccionan el recibo,
provocan divergencias/revocación y finalización sintética, y comprueban que
no se crea ningún Dispatch adicional. La CI existente corre en Windows/Ubuntu
y mantiene el smoke Electron.

## Siguiente corte

1. Proyección visible y autorizada de recuperación desde Electron main.
2. Adaptador de sandbox OS de producción con test de aislamiento real.
3. Session owner + sender duradero: captura de aceptación, cancelación y
   conciliación tras pérdida de respuesta.
4. Límite efectivo de tokens/coste por proveedor, una tarea/turno.
5. QA independiente, evidencias y PR propuesto bajo gate humano.

El funcionamiento automático de estos pasos NO está implementado por este PR.
