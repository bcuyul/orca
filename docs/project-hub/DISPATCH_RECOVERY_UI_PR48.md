# PR #48 — recuperar Dispatch de workers desde Project Hub

## Recorrido de operador

1. Entrar a `Project Hub → Inteligencia` de un repositorio local registrado.
2. Abrir la vista previa de un plan (`Inspeccionar conversión nativa`).
3. Seleccionar `Inspeccionar Dispatch de workers (solo lectura)`.
4. Ver el estado de los recibos SQL:
   - **Sin reservas**: no hay un claim de Dispatch visible para este plan/worktree.
   - **Reservado, no observado**: existe Dispatch; no hay evidencia de entrega
     efectiva al CLI. No reenviar automáticamente.
   - **Finalizado, sin QA verificada**: SQL informa settlement pero no
     demuestra cambios de código ni QA independiente.
   - **Conciliación manual**: detectadas identidad, concesión o evidencias
     inconsistentes. No permitir otro lanzamiento.

El informe siempre indica **no reenvío automático** y jamás presenta un
Dispatch como éxito de ejecución real.

## Límites de autoridad

- API de preload de lectura `inspectWorkerDispatches` con contrato compartido.
- IPC del main comprueba `senderFrame === mainFrame`, proyecto registrado,
  worktree local perteneciente al proyecto, revisión del DAG y SHA del plan.
- Consulta el lector host-only del PR #47. No crea grants, permisos, Dispatch,
  terminales ni procesos y no toca el proveedor.
- La inspección tiene límites de 100 recibos y nunca devuelve un permiso.
- Sin botones de reintento, ejecución ni `approved=true` desde renderer.
- El histórico de versiones antiguas del plan aún requiere auditoría del
  host: no se representa como candidato a relanzar.

## QA sin tokens

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/host-worker-dispatch-recovery.test.ts
pnpm typecheck
```

El smoke Electron de Project Hub recorre el botón y comprueba la respuesta
`Sin reservas` en un proyecto de prueba, en Windows y Ubuntu. Esto no
acredita un CLI real ni QA de código.

## Después

Sandbox OS de producción, owner de terminal autenticado, entrega durable de
mensajes con ack, cancelación/recuperación ante `unknown`, control real de
tokens/costo y QA/PR supervisados. No fusionar automatización de envíos antes
de que se puedan probar esas barreras en un laboratorio real.
