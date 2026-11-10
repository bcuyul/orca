# Project Hub — laboratorio sin tokens de agentes (PR #41)

Este laboratorio ejecuta **el Coordinator nativo y SQLite real en memoria**, pero
reemplaza el transporte del worker por un stub que registra mensajes en memoria.
**No se inicia Claude, Codex, OpenCode, Hermes ni ningún proceso o terminal.**
El laboratorio no consume tokens de modelo, no usa credenciales ni llama a APIs.

## Qué se comprueba

1. Materialización real de un plan humano aprobado en Run/Task con Forge→QA.
2. Recuperación de recibo nativo con `dispatchCount = 0`.
3. El Coordinator real **rechaza** ese Run en cuarentena: cero prompts.
4. Un Run sintético independiente envía un único mensaje a un worker simulado,
   recibe una confirmación y finaliza con el estado nativo `completed`.
5. Los Run/Task del plan de Project Hub no reciben Dispatch ni cambios de estado.

Esta es una prueba de integración local de los contratos existentes, **no una
habilitación de ejecución de planes de Project Hub**. El worker responde con
un mensaje falso; no afirma haber escrito código ni pasado QA real.

## Ejecutar desde PowerShell (Windows)

Desde un checkout de la rama del PR:

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run --config config/vitest.config.ts src/main/project-hub/zero-token-worker-lab.test.ts
pnpm exec oxlint src/main/project-hub/zero-token-worker-lab.test.ts
pnpm typecheck
```

También se ejecuta automáticamente dentro del workflow **Clean Project Hub
Integration** (Windows y Ubuntu) en pull requests hacia `main`. No usa secretos
ni claves de proveedores. Revisar la pestaña **Checks** de GitHub antes de
afirmar que pasó CI. Si las suites fallan, mantener el PR en Draft.

## Siguiente incremento (separado)

Permiso de ejecución autentificado desde Electron main, alcance de un solo
worker, presupuesto, verificación Git/sandbox, consumo atómico de permiso +
Dispatch y reconciliación ante caída. Solo entonces habilitar un CLI real con
autorización humana. Sin auto-push, merge ni despliegue.
