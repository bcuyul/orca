# Project Hub — lecciones acotadas para una tarea (PR #38)

Este incremento añade **selección determinista, de solo lectura y opcional** de lecciones declaradas como revisadas por una persona. No crea una base de memoria, no lee archivos del host, no escribe en Hermes y no inicia agentes.

## Contrato

- La fuente proporciona registros estructurados de un único `projectId`, `profile`, palabras clave, lección y referencia a un commit; el usuario declara la revisión humana. La referencia **no demuestra** que Orca haya autenticado el commit o su CI.
- Se descartan registros de otro proyecto/perfil, caducados (más de 180 días), futuros o sin coincidencia léxica con título, descripción y criterios.
- Un selector estable ordena por coincidencia y recencia; solo incorpora **dos lecciones** como máximo, con **480 caracteres** de texto acotado (lección + referencia y separadores). Entradas mal formadas se rechazan.
- `renderHubWorkerPrompt(document, delegation, memory?)` recibe un snapshot explícito, sin recuperación de red. Si no se pasa, el prompt permanece igual.
- El contenido se etiqueta como **datos orientativos**, no instrucciones ni evidencia verificada por el host. No concede permisos ni cambia autorización.
- Para el CLI `hermes`, Orca **no añade** ese bloque: Hermes carga su memoria de perfil automáticamente al iniciar una sesión y duplicarla desperdicia contexto.
- Por ahora no hay fuente Hermes autenticada conectada a este contrato; por ello **no hay memoria automática** ni una UI que afirme que la memoria ya está disponible.

## Próximo incremento, solo con evidencia del host

Conectar una exportación explícita, de solo lectura y con perfil/host comprobados; permitir revisión humana de los errores y sus fuentes antes de construir el snapshot. Mantener `MEMORY.md` y `USER.md` bajo la autoridad de Hermes, sin compartir credenciales ni modificar memorias de otros perfiles.

Referencia: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
