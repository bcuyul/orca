# PR #46 — reservar Dispatch nativo de un worker de forma atómica

## Contexto

Project Hub ya tiene aprobaciones, un Run/Task staged en SQLite y un permiso
host-only duradero de un turno (#45). Aún no había una transición segura del
permiso a `Dispatch`. La cuarentena SQLite protege tareas staged aun frente
a escrituras directas.

## Implementación

`reserveOneHubWorkerDispatch` es **host-only** y no está registrado en el
renderer, IPC o runtime de envíos. Exige:

- Permiso `agent_turn` previamente completado, no revocado, no vencido,
  para exactamente un task/Run/project/repo/host/worktree/plan SHA.
- Sandbox **real OS-enforced** aportado por una dependencia confiable del host
  y revalidado antes y durante la transacción. Un worktree solo es rechazado.
- Terminal/pane/proceso/launchTokenHash que el host haya autenticado; ausencia
  de proceso verificable bloquea.
- Identidad Git/worktree obtenida del host y revalidada con el escritor SQLite
  bloqueado, sin aceptar `approved=true` desde UI.

Dentro de un único `BEGIN IMMEDIATE`:

1. Revalida ledger/permit/recibos.
2. Rechaza Dispatch previo, tarea distinta, dependencias incompletas o task
   no staged/ready.
3. Cambia **solo** `tasks.spec.source` al estado de tarea autorizada,
   preservando el resto de la especificación.
4. Llama al método nativo `createDispatchContext` con identidad de proceso.
5. Persiste un recibo único por permiso, Task y Dispatch, y hace COMMIT.

Si falla cualquiera de los pasos, un solo ROLLBACK restaura el `spec` staged
sin admitir ningún Dispatch parcial. La cuarentena SQL existente **no se
debilita**: antes del COMMIT nadie ve el Task intermedio, y después el Task
está `dispatched`, no `ready`. El Coordinator genérico no puede
capturarlo en una ventana de carrera.

Un replay idéntico devuelve el mismo recibo y NO crea otro Dispatch.
Identidades o procesos diferentes se rechazan. Un Dispatch cuyo envío
al agente no se haya observado queda reservado para conciliación, sin
reenviar el prompt a ciegas.

## Límites y riesgos pendientes

- **No se abre ninguna sesión ni se envía un prompt.**
- `workerStarted:false` y `modelCalls:0` expresan exactamente el alcance.
- No hay aún proveedor OS sandbox real, ni sesión host conectada, ni botón
  de ejecución en Project Hub.
- El Dispatch reservado no garantiza que un worker haya visto las
  instrucciones, ni que QA o CI se hayan ejecutado.
- El límite de un turno no controla tokens de proveedor; gastos y cuotas
  necesitan enforcement en el sender.
- No activar este módulo en producción sin reconciliación de Dispatch sin
  envío, cancelación y verificación de proceso/identidad tras reinicio.
- No sustituir este contrato por un simple cambio de `tasks.spec` en el
  renderer ni eliminar los triggers de cuarentena.

## Pruebas

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/host-worker-atomic-dispatch.test.ts
pnpm exec oxlint src/main/project-hub/host-worker-atomic-dispatch.ts src/main/project-hub/host-worker-atomic-dispatch.test.ts
pnpm typecheck
```

CI: Windows/Ubuntu native integration y Electron smoke, sin gastar tokens.
No fusionar hasta CI verde y revisión de trust boundary.
