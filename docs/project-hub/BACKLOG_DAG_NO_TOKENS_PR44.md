# PR #44 — Backlog → DAG determinista → aprobación humana

Este corte evita copiar el JSON de Atlas cuando solo necesitamos una estructura
mínima y explícita para una historia del backlog.

## Ruta en la interfaz

1. Crear una historia/tarea con **criterios de aceptación** en el Backlog.
2. `Inteligencia → Crear plan directamente desde backlog · cero tokens`.
3. Elegir el elemento y su especialidad declarada: Forge, Data o Flow.
4. `Generar DAG desde backlog (sin IA)` crea una propuesta append-only
   con implementación → QA dependiente y revisión independiente.
5. El usuario **revisa y aprueba** la propuesta.
6. `Preparar plan automáticamente (supervisado)` del PR #43 ejecuta
   el laboratorio, valida el plan en el host, solicita aprobación de creación
   de Run/Task y verifica los recibos nativos.

No se crea Run sin aprobación; tampoco se crea Dispatch ni CLI. No se añaden
permisos, modelos, coordinadores paralelos o ejecutores innecesarios.
La especialidad se elige explícitamente; el código no adivina mediante IA.

## Control de costes

Este generador cuesta **cero tokens de agentes**; no pretende reemplazar el
razonamiento arquitectónico de Atlas para tareas complejas. Deja el flujo
manual/Atlas JSON disponible. La tarea QA es una **tarea del plan**, no una
segunda invocación automática de modelo; se podrá ejecutar manualmente
o por un revisor independiente cuando el host tenga permisos y sandbox.

## Controles

- Solo elementos `backlog` o `ready` con criterios de aceptación.
- Rechazo de planes duplicados para el mismo objetivo de backlog.
- IDs/timestamps/roles validados mediante `isHubPlanProposal`.
- Respetar máximo 30 planes y el historial append-only.
- La propuesta solo puede transformarse en Run mediante aprobación humana y
  consentimiento nativo separado en #43.
- UI y regresión Electron comprueban que no aparece acción de preparación
  antes de aprobar el plan.

## Tests

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/shared/project-hub-backlog-dag-template.test.ts
pnpm exec oxlint src/shared/project-hub-backlog-dag-template.ts src/shared/project-hub-backlog-dag-template.test.ts
pnpm typecheck
```

Windows/Ubuntu + Electron smoke y revisión antes de merge.
