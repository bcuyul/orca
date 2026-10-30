# Orca Project Hub — laboratorio Hermes-style y CI/CD (2026-10-30)

## Alcance y autoridad

Este laboratorio es **Orca Desktop en perfil de desarrollo** (`pnpm dev --worktree-profile`), no una copia falsa del motor, y **no es producción**.
El motor de autoridad sigue siendo el runtime de Orca. No desplegar otro scheduler ni escribir directamente su SQLite.
Project Hub contiene planes e identidades; los Runs, Tasks, Dispatches y mensajes pertenecen al orquestador nativo de Orca.
`agent.launchReplay` es un lanzamiento/handoff de CLI con recibo inicial: **no** equivale a una tarea supervisada completada.

## SOUL.md y perfiles

Roles fuente en `src/shared/project-hub-souls/{atlas,forge,flow,data,qa}/SOUL.md`.
`src/shared/project-hub-agent-profiles.ts` incorpora el texto versionado al bundle de Electron mediante importaciones `?raw`; no lee rutas elegidas por el usuario ni da credenciales extra.
Project Hub registra `profile` inmutable junto con el `operationId` antes del lanzamiento y adjunta su SOUL a las instrucciones enviadas al CLI.
Los registros antiguos sin `profile`, incluido PH-001, siguen siendo válidos y muestran Forge como perfil heredado, **sin alterar el historial**.
La elección `SOUL.md` no cambia automáticamente el modelo o proveedor ni crea un perfil Hermes separado: es una instrucción textual para OpenCode/Codex/Claude/Hermes.

Un futuro bridge nativo deberá implementar explícitamente la ruta supervisada de Orca: Run autorizado → Tasks/relaciones → worker-start/Dispatch → mensajes y evidencias → revisión/CI → resolución auditada.
No se deben inventar estados de finalización, ni marcar `worker_done` sin el Dispatch autorizado. No iniciar un nuevo worker para una operación `unknown` usando un nuevo ID.

## CI en el fork

`.github/workflows/project-hub-lab-ci.yml` ejecuta en `ubuntu-latest` y `windows-latest` con `contents:read`, sin secretos, en cada push a `feat/project-hub-hermes-delegation` y en PR a su base de desarrollo. **También se ejecuta estando Draft**.

Fases:
1. Instalación reproducible: Node 24, pnpm fijado por repo y preparación del runtime nativo mediante la acción existente.
2. Lint focalizado en límites de Project Hub y launcher.
3. `pnpm typecheck` integral.
4. Vitest focalizado en ambas plataformas: delegación, cupos, persistencia y garantías de replay/at-most-once. Windows comprueba explícitamente las regresiones de SQLite `EBUSY`.
5. `pnpm run build:electron-vite` en Linux (main + preload + renderer).
6. Artefacto temporal `out/` de la lane Linux para inspección de la compilación, **no instalable**, 3 días de retención.

No hay `pull_request_target`, token de escritura, publicación de releases, `push` a ramas, merge, IIS, Dokploy, servidor o VM. No constituye todavía CD productivo.

## CD futuro, deliberadamente bloqueado

Requiere una segunda puerta distinta del CI:
- PR revisado y con todos los checks requeridos en verde, además de prueba supervisada Windows Electron y aislamiento Git.
- Resolver la cadena de PRs: #2 hereda el experimento HTML incompatible #1; **no mergear esa pila a main tal cual**.
- Build distribuible firmado o de laboratorio, con versión/SHA, checksum y artefacto conservado.
- Entorno de staging aislado, aprobación humana, variables protegidas y dry-run de rollback antes de cualquier despliegue real.
- Producción solo mediante autorización de release separada. Ningún `SOUL.md` puede autorizar despliegue.

## Levantar el Orca de pruebas en Windows

El cambio remoto **no inicia una aplicación en tu PC**. En PowerShell, sin trabajo local sin confirmar:

```powershell
cd "$HOME\Projects\Orca-ProjectHub-Hermes"
git status --short
git fetch origin refs/heads/feat/project-hub-hermes-delegation:refs/remotes/origin/feat/project-hub-hermes-delegation
git merge --ff-only origin/feat/project-hub-hermes-delegation
Get-NetTCPConnection -LocalPort 15388 -State Listen -ErrorAction SilentlyContinue
# Solo si 15388 está libre y no existe ya una instancia del mismo perfil:
pnpm dev --worktree-profile
```

No forzar merge con árbol sucio, no matar procesos ni ejecutar `pnpm dev` dos veces. Si el puerto está ocupado, inspeccionar antes.
Para usar la orquestación real, activar Settings → Experimental y consultar `orca status --json` y `orca skills get orchestration --full` en el ejecutable asociado a esa instancia. No asumir que la CLI global apunta al runtime de desarrollo.

## PH-001 (no ejecutar de nuevo)

- Project Hub: `unconfirmed`; ledger SQLite: `unknown`.
- Identificador: `1793294206750-0f0392fda0b64ea9960fb44463a3756a`.
- Worktree previsto: `ph-ph-001-c216b3`, sin rama ni worktree observados.
- No había proceso OpenCode visible al revisar. La ausencia es evidencia parcial, **no prueba que nunca hubiera efectos**.
- No borrar/reparar SQLite, no alterar la delegación, no liberar cupo ni volver a lanzar PH-001.
- La conciliación autoritativa sigue pendiente; usar una historia **nueva**, aprobada, para el próximo smoke test.

## Límites de lo implementado hoy

Selección de SOUL + handoff CLI sí. Automatización de reviewer, mensajería nativa Run/Task/Dispatch desde Project Hub, cierre de ciclo automático, reconciliación post-reinicio y CD desplegable **no**.
La suite y el build de CI no sustituyen la verificación Electron sobre Windows; etiquetar como no verificado hasta comprobarlo.
