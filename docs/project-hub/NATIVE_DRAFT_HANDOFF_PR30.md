# PR #30 — Asistencia nativa, sin portapapeles

Project Hub prepara un encargo Atlas, Forge/Flow/Data o QA en una nueva sesión de chat nativa; la persona decide si lo envía. La función requiere worktree local, catálogo nativo confirmado de agentes habilitados, revisión explícita del borrador y capacidad de chat estructurado confirmada por el host.

- Atlas: planificación con SOUL y contexto del proyecto, o replanificación basada en bloqueo.
- Forge: DAG aprobado, tarea implementable y SHA base manual o capturado de Git limpio.
- QA: última entrega declarada de la tarea, con report ID y SHAs asociados.
- Lanzamiento nativo existente: requestedSurface chat y promptDelivery draft; si el host rechaza chat, no se abre un terminal alternativo.
- No hay envíos automáticos, Runs, Tasks, Dispatch, commits, worktrees, permisos nuevos ni QA acreditado.
- Coordinator mantiene ejecución bloqueada. El modo manual externo sigue como respaldo.

El siguiente incremento requerirá admisión host-only, recibos de sesión vinculados a plan/tarea, sandbox OS real, mensajes idempotentes y reconciliación de resultados antes de habilitar ejecución supervisada.
