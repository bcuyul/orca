# Handoff manual asistido por Git — primera iteración

## Problema
El flujo humano Atlas → Forge → QA exigía pegar dos SHA de Git y escribir a mano una referencia de commit. Esto no agrega control humano útil: Orca ya conoce el worktree activo y dispone de APIs nativas de lectura de Git.

## Comportamiento incluido
1. Se selecciona un plan de Atlas aprobado y una tarea Forge/Flow/Data.
2. **Leer SHA base desde Git local** consulta `window.api.git.status` y `window.api.git.history` sobre el worktree local activo, sin ejecutar comandos externos desde Project Hub.
3. Después del trabajo, **Leer entrega desde Git local** comprueba un HEAD diferente del de partida y rellena la referencia como **commit local sin diff/CI verificados**.
4. El usuario sigue documentando las pruebas realizadas, puede corregir los datos y decide si registrar una entrega declarada.
5. QA permanece independiente y no adquiere permisos de ejecución; la aprobación manual no acredita CI.

## Validación fail-closed
- Se requiere worktree de host `local` y ruta existente en la proyección del worktree activo; no se propone inspección para hosts remotos.
- `status.head`, `history.currentRef.revision` y `history.items[0].id` deben coincidir y tener 40 caracteres hexadecimales.
- Estado de Git sin error, sin truncamiento y sin archivos modificados/no confirmados; de lo contrario no se rellena el campo.
- El SHA de la entrega tiene que diferir del SHA base. No se genera commit, fetch, push, branch ni worktree.
- Las referencias automáticas son para **orientación y declaración**: no se verifica relación de ancestro, diff, CI ni identidad de un ejecutor externo.
- Las rutas remotas, la automatización supervisada, la revisión autenticada y la ejecución vía Coordinator quedan para incrementos futuros.

## Pruebas
`src/shared/project-hub-git-assist.test.ts` y
`src/renderer/src/components/right-sidebar/ProjectHubHandoffPanel.test.tsx`
forman parte del workflow `Clean Project Hub Integration` en Windows y Ubuntu, junto al typecheck de todo el workspace y los smoke tests de Electron.

## Siguiente diseño
Conservar el formulario manual como **anulación explícita**. El modo automático supervisado deberá consumir los mismos datos de inspección, además de recibos autenticados del host y una autorización por alcance, para coordinar tareas y emitir cambios de estado; nunca debe derivar autorización desde un SHA leído o una revisión humana declarada.
