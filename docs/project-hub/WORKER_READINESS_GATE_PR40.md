# Project Hub — diagnóstico de preparación de worker (corte 1)

Este corte conecta la vista **Inteligencia** con recibos de Run/Task nativos
ya existentes, sin inventar un segundo coordinador.

## Implementado

- Proyección pura de lectura de `NativePlanPreview` + `HubNativeStageRecovery`.
- Exige plan aprobado, un único Run y recibo de SQLite coincidente, sin Dispatch
  previo, sin tareas huérfanas y con mapa de IDs completo y no duplicado.
- Identifica las tareas raíz como **candidatas a preparación** y muestra las que
  esperan dependencias. No presume que ninguna dependencia esté completada.
- Muestra los bloqueos restantes en la UI sin botón de lanzamiento.
- Nunca emite `executionAuthorized: true` ni `dispatchAllowed: true`.

## NO implementado

Permiso de ejecución, consumo de presupuesto, terminal, CLI, worker, Dispatch,
push, merge, deploy ni auto-update. No existe autorización derivada de aceptar
un plan. La proyección de React no es un guard de seguridad del host.

## Siguiente corte: gate real en Electron main

1. Reconciliar los diseños del Draft #12 con el staging y recuperación de #33/#35,
   sin reaplicar ramas apiladas ni crear otra tabla de permisos.
2. Autenticar autorización independiente desde ventana main confiable; fijar
   proyecto, repositorio, host, worktree, Run/Task, SHA y límite de un turno.
3. Validar CLI/host/sandbox, estado Git y cuota real mediante autoridad del host.
4. Consumir el permiso y crear Dispatch de forma atómica e idempotente en SQLite.
5. Ejecutar **un** worker de laboratorio; inspeccionar procesos/sesiones y
   fail-closed en cancelación, reinicio, pérdida de respuesta y reintentos.
6. Implementar QA independiente después; no permitir push/merge/deploy implícitos.

## Validación

```powershell
pnpm exec vitest run src/shared/project-hub-worker-readiness.test.ts
pnpm exec oxlint src/shared/project-hub-worker-readiness.ts src/shared/project-hub-worker-readiness.test.ts
pnpm typecheck
```

CI Windows + Ubuntu y Electron smoke antes de fusionar. Las pruebas no
demuestran ejecución real: este corte es deliberadamente solo lectura.
