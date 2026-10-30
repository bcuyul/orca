# Orca Project Hub Intelligence vNext — épica y backlog de historias
Fecha: 2026-10-30
Estado: **propuesta de planificación**, no implementación ni autorización de lanzamiento.
Base técnica: PR #5 (Draft): https://github.com/bcuyul/orca/pull/5

> GitHub Issues está deshabilitado en `bcuyul/orca` (HTTP 410). Estos identificadores EV-* son tickets versionados aquí, **no números de Issues reales**. Se podrán importar a Jira u otro tracker conservando sus identificadores.

## Meta y principio de diseño

Un usuario describe el producto en lenguaje natural → Atlas y brainstorming elaboran historias independientes y DAG → aprobación humana → ejecución autorizada mediante el orquestador **nativo** de Orca → workers aislados aplican las skills adecuadas → QA independiente verifica diff+SHA+tests+CI → correcciones/replanificación supervisadas → aprobación humana para integrar.

### Skills candidatas y política de confianza
- **Ponytail**: minimalismo/YAGNI, menor código innecesario, `ponytail-review`; evaluar https://github.com/DietrichGebert/ponytail.
- **Superpowers**: `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`; evaluar https://github.com/obra/superpowers.
- No declarar ninguna skill "mejor" sin benchmark de precisión, bugs, tokens, complejidad, compatibilidad del host y seguridad. No instalar/ejecutar software de terceros por el hecho de figurar en este backlog.
- Catálogo bajo control de versión, SHA/procedencia/licencia/permissions; lectura progresiva sólo de contenido pertinente. El texto `SOUL.md` guía comportamientos pero no concede permisos.
- QA es independiente en identidad de sesión y evidencia, y de sólo lectura. Revisor no modifica archivos ni ejecuta builds arbitrarios sin control del host.

### Infraestructura y límites
- Reutilizar Project Hub + `src/main/runtime/orchestration/coordinator.ts` + su DAG/convergence/dispatch. **No** incorporar grafo DB ni segundo scheduler; **no** escribir SQLite directamente.
- Planes v1 aceptan DAG con 1–20 nodos. Historial y decisiones son append-only.
- `agent.launchReplay` no equivale a Run/Task/Dispatch ni prueba resultado final.
- No auto push, merge, PR, deploy o Jira write. No reintentar/resetear PH-001 (`unknown/unconfirmed`).
- Scope inicial: ejecutables CLI locales, Windows primero; Linux CI; SSH remoto bloqueado hasta rutas/recibos específicos.
- Tokens: enviar resumen de tarea, aceptación, dependencias inmediatas, paths/diff, 0–3 skills seleccionadas y recuerdos aprobados; medir antes de proclamar ahorro.

## Orden de implementación / puertas

| Ola | Tickets | Entregable / puerta |
| --- | --- | --- |
| 0 · Fundaciones | EV-01 → EV-02 → EV-03 | Skills seguras, selección bajo demanda, historias DAG editables y aprobables |
| 1 · Ejecución | EV-04 → EV-05 → EV-06 → EV-07 | Atlas CLI → Run/Task/Dispatch real → workers con skills → QA con evidencia |
| 2 · Optimización | EV-08, EV-09, EV-10, EV-11 | Correcciones, memoria, tokens/costos medidos, interfaz guiada |
| 3 · Entrega | EV-12 | E2E Electron/CI y revisión independiente, sin despliegue |
 
## Definición de terminado de cada ticket
1. Evidencia de contrato de autorización, aislamiento repo/proyecto/host, y seguridad (incluyendo incertidumbre).
2. Tests nuevos/ajustados + CI relevante (Oxlint, TypeScript, Vitest, build según alcance), con commit SHA.
3. Sin indicadores falsos de QA/CI, sin secretos en prompts/logs y sin permisos ocultos.
4. Demo de usuario y documentación breve del cambio.
5. Cada ticket en rama/worktree exclusivo; un PR pequeño por ticket o grupo estrictamente dependiente; QA independiente.


## Ola 0 — Fundaciones y contratos

### EV-01 · Registro confiable y versionado de skills

**Historia:** Como responsable de un proyecto, quiero que Orca me muestre el origen, la versión y los permisos de cada skill antes de habilitarla, para evitar código o instrucciones no confiables.

**Rol sugerido:** Forge + QA. **Depende de:** ninguno.

**Alcance:** Definir manifiesto skillId, publisher, source, pinned SHA/tag, licencia, compatibilidad host, permisos, categoría, triggers, riesgos y estado approved/disabled; catálogo inicial *propuesto* de Ponytail y Superpowers, sin instalación automática.

**Criterios de aceptación:**
1. Solo se pueden activar skills de allowlist verificadas; el contenido y los scripts se tratan como no confiables hasta revisión explícita.
2. Cambios de SHA, permisos o licencia invalidan aprobación previa; no se aceptan rutas arbitrarias, descargas silenciosas ni código de scripts ejecutado al registrar.
3. Trazabilidad de habilitación/revocación por usuario/proyecto; modo sólo catálogo si el host no soporta la skill.

**Pruebas:** Unitarias de manifiestos inválidos, permisos excesivos, SHA cambiado y fuentes maliciosas; no red; revisión de licencias MIT.

### EV-02 · Router de skills por tarea, rol y presupuesto de contexto

**Historia:** Como desarrollador, quiero que cada agente reciba únicamente las skills relevantes para su tarea, para evitar prompts innecesarios y conflictos de instrucciones.

**Rol sugerido:** Atlas + Forge. **Depende de:** EV-01.

**Alcance:** Selección determinista por rol + tipo de trabajo + lenguaje + evidencia disponible; por defecto 0–3 skills/task. Progressive disclosure: nombre/trigger → SKILL.md aprobado → referencias requeridas. Version de skill en recibo; conflicto de instrucciones resuelto por política de prioridad.

**Criterios de aceptación:**
1. Atlas elige brainstorming/writing-plans; Forge elige TDD/Ponytail; QA prioriza revisión independiente, verification y seguridad según tarea.
2. Nunca inyectar una biblioteca completa de skills; límites configurables por presupuesto y contenido truncado con aviso, sin recortar reglas de seguridad.
3. Si no existe skill compatible, ejecutar bajo SOUL y contratos nativos; nunca inventar que una skill fue cargada.

**Pruebas:** Matriz de selección en tareas TypeScript, Python, documentación y seguridad; tests de desactivación, presupuesto y conflictos.

### EV-03 · Brainstorming → historias de usuario y DAG editable

**Historia:** Como vibecoder, quiero describir una idea en lenguaje natural y recibir historias pequeñas con criterios de aceptación y dependencias, sin escribir JSON.

**Rol sugerido:** Atlas. **Depende de:** EV-02.

**Alcance:** Contrato de propuesta versionada que incluye historia 'Como... quiero... para...', valor, criterios, riesgos, rol sugerido, dependencias, estimación opcional y source; se valida con el DAG existente (1–20 tareas). Editor y aprobación sin ejecutar.

**Criterios de aceptación:**
1. Atlas puede proponer historias sin alterar el Backlog ni disparar workers; aceptación y edición requieren intervención humana.
2. Dependencias inexistentes o cíclicas se rechazan, y las historias mantienen ID legible + ID técnico inmutable.
3. El brainstorming no oculta decisiones abiertas; muestra 1–3 preguntas cuando un requisito crítico es ambiguo y no asume permisos.

**Pruebas:** Pruebas de propuesta inválida/cíclica, persistencia/revisión, migración de planes existentes y mensajes comprensibles.

## Ola 1 — Agentes y revisión con evidencia

### EV-04 · Conector nativo Atlas CLI para obtener propuestas

**Historia:** Como propietario del proyecto, quiero ejecutar Atlas desde Project Hub y recibir un plan verificable, sin copiar prompts ni configurar manualmente una terminal.

**Rol sugerido:** Forge. **Depende de:** EV-02, EV-03.

**Alcance:** Host-owned connector sobre CLIs locales compatibles; preflight cuenta/host/proveedor; operationId único, tiempo máximo y recibo durable; salida JSON limitada validada en main; cancelación segura sin convertir `unknown` a fracaso.

**Criterios de aceptación:**
1. La aprobación 'generar propuesta' puede iniciar un Atlas nuevo de laboratorio, pero nunca ejecuta el DAG propuesto.
2. Timeout/no receipt preserva 'unknown/unconfirmed' y no genera un segundo launch o worktree; no reusar PH-001.
3. Permisos y contexto sensible se muestran antes de enviar al CLI; no se asumen APIs directas ni suscripción/token gratuitos.

**Pruebas:** Mock CLI éxito, JSON inválido, respuesta duplicada, crash/restart, timeout y proveedor ausente; E2E Windows.

### EV-05 · Bridge autorizado Project Hub → Run/Task/Dispatch nativos

**Historia:** Como operador, quiero aprobar la ejecución de un DAG y ver sus tareas en Orca, para tener seguimiento real y no sólo registros manuales.

**Rol sugerido:** Forge + Atlas. **Depende de:** EV-04.

**Alcance:** Diseñar adaptador a contratos RPC y coordinación nativa con runId/taskIds/dispatchIds auténticos; garantizar que el Coordinator no vuelva a descomponer tareas ya validadas. CAS y ownership repoId/hostId/base SHA; no escribir SQLite.

**Criterios de aceptación:**
1. Un plan aprobado no ejecuta hasta recibir autorización de lanzamiento distinta; un Run verdadero tiene tareas y dependencias nativas congruentes.
2. Repetición de petición con la misma identidad es idempotente; operaciones 'unknown' impiden retry inseguro y reservan cupos.
3. Coordinator/worker real determina progreso, no resumen del agente. No push, merge, deployment ni Jira automáticos.

**Pruebas:** Integración RPC para creación, deduplicación, host incorrecto, restart, heartbeat, DAG no duplicado; PH-001 permanece intacto.

### EV-06 · Workers aislados con skills y pruebas apropiadas

**Historia:** Como desarrollador, quiero que Forge/Flow/Data reciban su historia, contexto mínimo y skills adecuadas en worktrees aislados, para implementar y probar sin interferencias.

**Rol sugerido:** Forge + Flow. **Depende de:** EV-02, EV-05.

**Alcance:** Paquete de tarea versionado: objetivo, acceptance, dependencias, fragmentos relevantes, archivos, skills seleccionadas, SOUL, base SHA, límites de herramientas y presupuesto; checkout basado en Orca existente.

**Criterios de aceptación:**
1. Las tareas independientes pueden despacharse en paralelo dentro del límite autorizado; no dos workers en un mismo worktree para escrituras concurrentes.
2. TDD y Ponytail fomentan reutilización/simplicidad, sin sacrificar tests ni ocultar deuda; pruebas elegidas por stack del repo.
3. Un adapter sin soporte de skills informa downgrade y aplica guía autorizada; no ejecuta plugins externos por sorpresa.

**Pruebas:** Unitarias del paquete de contexto; integración con simuladores de dos workers, conflicto de worktrees, falta de skill, bloqueo por presupuesto.

### EV-07 · Revisor QA independiente con diff, commit y CI verificables

**Historia:** Como revisor, quiero inspeccionar código y pruebas reales desde una sesión distinta del implementador, para impedir aprobaciones ficticias.

**Rol sugerido:** QA. **Depende de:** EV-05, EV-06.

**Alcance:** Snapshot inmutable de base/head SHA, diff, criterios originales y resultados firmes de CI; runner QA de sólo lectura. Skills candidatas Ponytail Review, requesting-code-review, verification-before-completion, systematic-debugging (según evidencia).

**Criterios de aceptación:**
1. QA no recibe como evidencia única el resumen del implementador y no puede editar, ejecutar despliegues ni aprobar su propia tarea.
2. Veredicto structured approved/changes-requested/inconclusive con ruta/línea/severidad y evidencia fuente; CI pendiente o inaccesible produce inconclusive.
3. El host valida SHA/identidad de checks; la mera cadena 'tests passed' no acredita CI.

**Pruebas:** PR bueno, error real, CI inexistente/stale, prompt injection en diff, auto-review denegado y cambios tras revisión.

## Ola 2 — Aprendizaje, presupuesto y UX

### EV-08 · Ciclo QA → corrección → replanificación supervisada

**Historia:** Como usuario, quiero que Orca proponga correcciones cuando QA rechaza una tarea, sin reiniciar todo el proyecto ni repetir trabajo validado.

**Rol sugerido:** Atlas + QA. **Depende de:** EV-07.

**Alcance:** Mapear hallazgos a blocker tipado, generar revisión inmutable del DAG y reactivar sólo nodos afectados tras autorización; conservar run/task/dispatch y SHA previos.

**Criterios de aceptación:**
1. Se distingue 'solicitar corrección' de 'autorizar worker'; nuevas operaciones tienen ID único y dependencias recalculadas.
2. Historial de revisiones y vetos persiste, con límite de rondas; no autopromoción de changes-requested a aprobado.
3. Operaciones inciertas no se reintentan sin reconciliación autoritativa.

**Pruebas:** Caso de replan parcial, ciclos, repetición de eventos, límites de rondas y transición denied.

### EV-09 · Memoria de aprendizajes con evidencia y promoción revisada

**Historia:** Como agente, quiero recuperar lecciones verificadas de ejecuciones anteriores, sin compartir secretos o errores no comprobados entre proyectos.

**Rol sugerido:** Data + QA. **Depende de:** EV-01, EV-07.

**Alcance:** Memoria candidata por proyecto, evidencia real (diff/tests/CI), dedupe/redacción, vigencia y aplicabilidad; catálogo compartido solo tras aprobación y PR revisado; búsqueda léxica en MVP.

**Criterios de aceptación:**
1. Memorias privadas no se leen entre proyectos; sólo aprobadas se incorporan al prompt pertinente, con límites de número/tamaño.
2. Promoción al catálogo compartido requiere revisión de privacidad, procedencia, versión y autorización humana, nunca auto-write a main.
3. Retrieval conserva atribución y marca obsoletas cuando cambian test/stack relevante.

**Pruebas:** Aislamiento entre proyectos, duplicados, revocación, secretos/PII y relevancia con benchmark.

### EV-10 · Presupuesto y telemetría real de tokens, tiempo y skills

**Historia:** Como usuario, quiero conocer el consumo de cada historia y limitar ejecuciones costosas, para usar modelos y skills eficientemente.

**Rol sugerido:** Data + Forge. **Depende de:** EV-02, EV-04, EV-05.

**Alcance:** Contadores de tokens in/out reales cuando los CLI/proveedores los expongan, estimaciones separadas y claramente marcadas, costo monetario sólo con tarifa y uso confirmados; tiempo, reintentos, skills/caché, modelo por fase. Presupuestos por Run/Tarea.

**Criterios de aceptación:**
1. Se admite presupuesto por tokens/iteraciones/tiempo; alcanzar el límite bloquea nuevos dispatches, sin matar procesos ambiguos ni prometer que detiene costos externos.
2. Dashboard ofrece costo/uso real, estimado o no disponible sin inventar cifras; no registra prompts completos ni secretos por defecto.
3. Comparación A/B sobre historias equivalentes: skill routing on/off, contexto bruto/recortado, calidad QA y retrabajo.

**Pruebas:** Proveedores sin usage, reporting incompleto, reinicio, cuotas y benchmarks reproducibles.

### EV-11 · Experiencia vibecoder: un asistente, no cinco formularios

**Historia:** Como vibecoder, quiero avanzar con pasos claros de idea → revisar plan → autorizar → progreso → resultado, sin aprender IDs o pegar JSON.

**Rol sugerido:** Forge + QA. **Depende de:** EV-03, EV-04, EV-05, EV-07.

**Alcance:** Wizard accesible con vistas simple/avanzada, nombres humanos, status de seguridad, skill plan y presupuesto resumidos; decisiones locales por tarjeta; explicaciones de bloqueos y QA con evidencia.

**Criterios de aceptación:**
1. Modo básico no pide SHA, IDs ni contratos JSON; modo avanzado permite inspeccionarlos y copiar diagnósticos.
2. Distingue propuesto/aprobado/despachado/en ejecución/inconcluso/verificado; 'aprobar plan' jamás equivale a iniciar/desplegar.
3. Mensajes y botones deshabilitados explican exactamente qué falta; persiste cambios y evita formularios cruzados.

**Pruebas:** Pruebas React/a11y para wizard, recarga, 1 proyecto+varios worktrees, incertidumbre y usuarios sin skills.

## Ola 3 — Validación integral

### EV-12 · Gate E2E Windows/Linux + seguridad y reconciliación

**Historia:** Como mantenedor, quiero evidencia automatizada y una prueba supervisada real antes de integrar esta evolución, para proteger los proyectos existentes.

**Rol sugerido:** QA + Forge. **Depende de:** EV-04, EV-05, EV-06, EV-07, EV-08, EV-10, EV-11.

**Alcance:** Matriz CI lint/typecheck/unit/integration y Electron Windows smoke; Linux build+tests; inyección/secret-leak/host ownership; pruebas de cancel/restart/unknown; revisar linaje PR #1–#5.

**Criterios de aceptación:**
1. Nueva historia de laboratorio llega de idea a revisión QA con SHA+CI reales sin falsear Dispatch, sin tocar producción o servicios remotos.
2. PH-001 sigue unknown/unconfirmed hasta proceso de reconciliación seguro separado; sin force release/replay manual de ID incierto.
3. No se mezcla el HTML experimental del PR #1 a main; merge/deployment siguen sujetos a revisiones/autorizaciones independientes.

**Pruebas:** E2E reproducible con logs redacted, reporte de matrix por OS, build comprobado y plan de rollback de laboratorio.

## Contratos de datos sugeridos (a validar en EV-01/EV-03/EV-05)
```text
StoryProposal { storyId, userStory, acceptance[], role, dependsOn[], risk }
SkillSelection { skillId, pinnedRevision, role, reason, tokensLoaded, sourceTrust }
TaskEnvelope { runId, taskId, repoId, hostId, baseSha, storyId, skills[], budget }
ReviewEvidence { reviewerSession, baseSha, headSha, files, checks[], findings[], verdict }
UsageEvent { runId, taskId, model, provider, tokensInput?, tokensOutput?, elapsedMs, dataQuality }
```
Los modelos de datos actuales de Orca son la autoridad; estos son campos conceptuales, no contratos aprobados.

## Métricas para decidir valor
- Calidad: % historias que pasan QA al primer intento, regresiones y falsos verdes.
- Eficiencia: tokens de entrada/salida **reales** por historia cuando disponibles; contexto por skill y costo monetario solo verificable.
- Flujo: tiempo de idea→plan→Run→QA, retrabajos, duplicados, bloqueos, aprobaciones e incidentes.
- Seguridad: 0 acciones externas no autorizadas; 0 mutaciones históricas; 0 relanzamientos de operaciones `unknown`.
- Comparación A/B de tareas equivalentes con/ sin routing de skills y sin cambiar los criterios de aceptación.
