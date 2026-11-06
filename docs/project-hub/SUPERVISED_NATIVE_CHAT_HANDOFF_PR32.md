# Project Hub — Incremento supervisado: lanzamiento, inventario y navegación

Este cambio está apilado sobre el PR #31; no debe fusionarse de manera independiente.

## Camino permitido

1. La persona revisa el prompt Atlas, Forge/Flow/Data o QA y autoriza abrir un borrador.
2. Orca solicita sesión nativa con modo draft, sin fallback a terminal.
3. Project Hub espera el recibo estructurado del host; conserva temporalmente la identidad exacta solo si no cambió proyecto, revisión ni worktree.
4. Un botón separado lee session.tabs.listAll del host local y confirma un único chat inequívoco y publicado.
5. Navega a la pestaña existente, sin enviar mensajes nuevos. Si hay conflicto o incertidumbre, no navega.

## Invariantes

- No envía prompts, no crea Run/Task/Dispatch, worktrees, commits, PRs ni permisos nuevos.
- La sesión acreditada sirve solo para navegación; no acredita trabajo finalizado, QA ni CI.
- No llama a rutas de reparación ni reveal con posibles efectos secundarios.
- No hay persistencia del vínculo en ProjectHubStore; requiere recibos de host con generación y fencing antes de habilitarla.
- Las respuestas visibility-unknown o tardías no disparan reintentos.
- Local-only: nunca asumir identidad de un host remoto.
- El envío automático supervisado queda bloqueado hasta integrar permisos host-only, saga idempotente y presupuesto.

## Validación esperada

Vitest del guard, lector e interfaz; Oxlint, pnpm typecheck y Electron smoke en Windows/Ubuntu.
El PR se mantiene Draft hasta comprobar CI en su head y una revisión independiente.
