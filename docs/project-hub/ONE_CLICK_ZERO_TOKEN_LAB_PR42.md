# Project Hub — laboratorio de un clic sin tokens

## Propósito

En **Project Hub → Inteligencia**, pulsar **«Probar orquestación sin tokens»**
para comprobar componentes nativos sin comandos, sin proveedores y sin recursos
externos. Es una prueba opcional e informativa, no una ejecución de planes.

## Garantías y alcance

- Electron main valida la ventana principal confiable y el `Project.id` registrado.
- Solo admite `{ projectId }`; no recibe prompts, comandos, rutas ni modelo.
- Un único laboratorio simultáneo por proceso.
- `OrchestrationDb(':memory:')`: los datos del usuario no se leen ni se escriben.
- Dos Run sintéticos independientes: uno `adaptive-untrusted-plan` que el
  Coordinator debe rechazar; otro ordinario con un worker falso.
- El worker falso usa el transporte en memoria, genera un recibo
  `worker_done` con el mecanismo nativo y el Coordinator finaliza.
- Se comprueba un Dispatch sintético, cero Dispatch en el Run staged y cero
  creación de terminales. Se aborta ante desvíos o tiempo límite.
- Retorna un informe estructurado con `modelCalls: 0` y
  `executionAuthorized: false`.
- No requiere tokens ni conexión a servicios de IA; GitHub Actions consume
  minutos de CI, que no son tokens de modelos.

## Qué NO acredita

No constituye prueba de que Forge/QA programen, de que se haya ejecutado un
CLI, de que los permisos de ejecución reales sean válidos ni de que CI de un
proyecto haya pasado. No habilita Run/Task de Project Hub, worktrees, push,
merge, deploy ni auto-update. La simulación de SQLite es nueva y temporal.

## Pruebas

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/offline-coordinator-lab.test.ts
pnpm exec oxlint src/main/project-hub/offline-coordinator-lab.ts src/main/project-hub/offline-coordinator-lab.test.ts src/shared/project-hub-offline-lab.ts
pnpm typecheck
```

El workflow *Clean Project Hub Integration* ejecuta las pruebas bajo
`src/main/project-hub`, además del smoke Electron en Windows y Ubuntu.

## Evolución

No confundir este laboratorio con un permiso para Dispatch. El siguiente corte
de producción deberá verificar aprobación autenticada, propiedad del host,
worktree y SHA, cuotas y sandbox; después consumir permiso y Dispatch de forma
atómica, con cancelación y recuperación de fallos. Mantener los gates humanos
según riesgo y no invocar cuatro agentes para tareas pequeñas.
