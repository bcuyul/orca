# Project Hub — Code Mode local: primera integración (solo lectura)

## Objetivo

Introducir descubrimiento progresivo y una receta local que combina varias consultas
del mismo snapshot del proyecto en una única respuesta compacta. **No** se instala
Cloudflare, no se contrata Workers Paid y no se lanza Hermes, Claude ni Codex.

Este corte es la **base de herramientas**, no un ejecutor de JavaScript generado
por agentes. El nombre "Code Mode" describe una dirección de evolución; el estado
real de esta entrega es **receta estática allowlisted sin ejecución de código**.

## Código y alcance

- \`src/shared/project-hub-code-mode-readonly.ts\`: catálogo, buscador y receta.
- \`src/shared/project-hub-code-mode-readonly.test.ts\`: regresiones de integridad.
- \`src/renderer/src/components/right-sidebar/ProjectHubCodeModeReadOnly.tsx\`: panel de laboratorio.
- \`Project Hub → Inteligencia\`: botón \`Analizar snapshot · 0 tokens IA\`.

Herramientas:

1. \`hub.backlog.summary\`: historias visibles por estado y total archivado.
2. \`hub.plans.summary\`: conteos de planes, tareas, decisiones y revisiones.
3. \`hub.delegations.summary\`: solo estados del registro de delegación.

**La receta recibe exclusivamente el \`HubDocument\` del proyecto autenticado y
el \`projectId\` esperado.** Rechaza un proyecto diferente, documento inválido,
herramientas desconocidas, repetidas o un número de herramientas fuera de rango.
No serializa títulos, requisitos, credenciales, prompts ni rutas locales;
solo agregados de conteo. Mantiene el documento intacto.

## Límites inalterables

- \`externalCalls: 0\`, \`modelCalls: 0\`, \`executionAuthorized: false\`.
- \`generatedCodeExecuted: false\`: ningún \`eval\`, \`vm\`, Worker dinámico
  ni \`new Function\`.
- No se accede a filesystem, red, shell, IPC, repositorios, SQLite ni Git.
- No se modifican permisos, cuotas, decisiones, planes, aprobaciones, tareas
  nativas, sesiones, worktrees ni historial de Dispatch.
- \`launched\` **no** significa que la historia esté terminada.
- \`unconfirmed\` **no** autoriza reintentos.
- El panel descarta visualmente resultados si la revisión del documento cambia.

## Pruebas focalizadas

\`\`\`powershell
pnpm test src/shared/project-hub-code-mode-readonly.test.ts
pnpm tc
pnpm check:changed --maxWorkers=2
\`\`\`

No se afirma que las pruebas pasaron hasta que CI o un entorno local las ejecute
y publique evidencias. No habilitar automáticamente ejecuciones de modelos.

## Fases siguientes (no implementadas)

1. Adaptar la receta a herramientas externas **solo lectura**, con
   consentimiento explícito, control de procedencia y reducción de resultados.
2. Añadir aislamiento real a nivel sistema operativo para código no confiable:
   contenedor/microVM o backend equivalente, sin acceso a credenciales ni red
   por defecto, límites verificables de CPU, memoria, tiempo y salida.
3. Definir permisos por herramienta en el host, límites de gasto y auditoría
   de llamadas, incluso si el programa invoca múltiples herramientas.
4. Medir latencia, tokens y fallos contra la orquestación tradicional.
5. Integrar Hermes mediante las capacidades nativas de Orca o un adaptador
   autenticado, sin crear un scheduler o base de datos paralelos.

La aprobación de un plan o una skill nunca es autorización de ejecución.
