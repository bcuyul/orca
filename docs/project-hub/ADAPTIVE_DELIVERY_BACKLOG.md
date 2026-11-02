# Backlog incremental: Orca Adaptive Delivery

> Epic de diseño **AD**; NO GitHub Issues ni Jira tickets creados. Complementa EV-01…EV-12 (`INTELLIGENCE_VNEXT_BACKLOG.md`), sin alterar su autoría ni estado.

## Secuencia y prioridades

| ID | Entregable | Dependencias | Prioridad | Rol sugerido | Definición de terminado |
| --- | --- | --- | --- | --- | --- |
| AD-00 | Documentación, ADR, opciones de viabilidad y laboratorio reproducible | PR #5 docs | P0 | Atlas/QA | Fuentes verificables, benchmark, tests y límites honestos |
| AD-01 | `IntentAnalyzer` / `WorkKind` sin lanzamientos | EV-03 | P1 | Forge | Microfix/use-case/module/project/research; riesgo independiente de tamaño; override humano |
| AD-02 | Elicitación swing, MCDA, sensibilidad, WSJF-like baseline | AD-00/01 | P1 | Data/Forge | Pesos registrados, no arbitrarios; comparadores reproducibles |
| AD-03 | Política de admisión Scope/Budget en host | EV-05, EV-10 | **P0 pre-autonomía** | Forge/QA | Autoridad RPC, no trust de texto, lim. llamadas/timeout, fail-closed |
| AD-04 | Priority Engine + topological eligibility; solver pequeño opt-in | AD-02, AD-03, EV-05 | P1 | Forge/Data | DAG respetado, no tarea prohibida, comparación FIFO/WSJF |
| AD-05 | AgentAllocator / estimaciones por rol y disponibilidad | AD-04, EV-06 | P2 | Forge | No write concurrente al mismo worktree; sin presupuestos ficticios |
| AD-06 | `QualityController` y evidence ledger con SHA | EV-07, AD-03 | **P0 pre-autonomía** | QA/Forge | Tests verificables, revisor independiente, stale CI detectado |
| AD-07 | Repair loop acotado, progreso verificable, no replay unsafe | EV-08, AD-03, AD-06 | P1 | Forge/QA | Rondas limitadas; bloqueo cuando no hay progreso |
| AD-08 | `MilestonePolicy`, `DeliverySession`, gates humanos | AD-03, AD-06, EV-05 | P1 | Forge | Microfix sin MVP; proyecto con pausa; CAS/unknown/restart |
| AD-09 | Continuación automática checkpoint→Run siguiente | AD-08, AD-07 | P1 | Forge/QA | Un Run adicional único por autorización y evidencia actual |
| AD-10 | Estadística de esfuerzo/éxito, Brier y drift | EV-10, AD-06 | P2 | Data | Validación temporal y baseline, sin fuga entre proyectos |
| AD-11 | EVSI para preguntar/investigar, solo advisory | AD-02, AD-10 | P2 | Data/Atlas | Distribuciones explícitas, no eludir permisos humanos |
| AD-12 | CP-SAT para RCPSP (opcional) | AD-04, AD-05 | P3 | Forge/Data | Mejora neta vs heurísticas y empaquetado Windows/Linux |
| AD-13 | Kev shadow mode (opcional) | AD-03, AD-10 | P3 | Data/QA | A/B por dominio, calibración y latencia; nunca autoridad |
| AD-14 | UI adaptativa, reordenamiento con override y explicación | EV-11, AD-08 | P2 | Forge | Decisión explicable, no falsa QA, accesibilidad |
| AD-15 | E2E Windows/Linux y piloto real con consentimiento | EV-12, AD-07/08/09 | **P0 pre-merge funcional** | QA | Run/Task/Dispatch reales, reconciliación, pruebas sin datos privados |

## Propuesta de PRs para limitar riesgo

- **PR-AD-00 (este paquete):** solo documentación + CLI offline `tools/adaptive-delivery-lab`. No modifica `src/` ni enlaza con Electron. Puede revisarse sobre la rama del PR #5, pero su dependencia de linaje #4/#1 sigue aplicando: **no merge sin reconciliar la pila**.
- **PR-AD-01:** contratos puros, tests, análisis de intención/swing, sin lanzamientos.
- **PR-AD-02:** host authority, presupuesto, scope y evidencias (hacer PRs aún más pequeños si las migraciones son complejas).
- **PR-AD-03:** bridge de Atlas → Run/Task/Dispatch con simuladores, sin producción.
- **PR-AD-04:** reparación y milestones adaptativos.
- **PR-AD-05:** UI de aceptación + pruebas E2E locales y Windows/Linux.
- **PR-AD-06:** solver y Kev **solo si** un experimento demuestra mejora neta.

## Pruebas mínimas de seguridad y economía

- Rechazar ciclos, dependencias inexistentes, restricciones imposibles, presupuesto inválido, pesos malformados, permisos pendientes.
- Repetir petición de lanzamiento/aceptación con la misma identidad: sin duplicación.
- Timeout después de envio CLI: `unconfirmed`, jamás relanzamiento automático ciego.
- Mismatch repoId/hostId/base SHA: bloqueo.
- Revisión QA sobre SHA viejo: invalida gate.
- Regla humana de permisos/safety: no se sobreescribe por optimizador o Kev.
- Tarea pequeña: no genera burocracia ni llama innecesariamente a Atlas/Claude.
- Variable `usage` ausente: no inventar tokens ni ahorro monetario.
- Recuperación tras cierre Electron y tras shutdown abrupto.

## Criterios de economía medibles

- Primero comparar: FIFO, WSJF-like, MCDA/topological; luego MILP/CP-SAT.
- Informar: `acceptedOutcomePerToken` solo cuando tokens reales; si no, `callsPerAcceptedOutcome`, tiempo y calidad.
- Con pocas observaciones, reportar escenarios y rangos; no extrapolar superioridad.
- No ejecutar varios agentes para tareas que requieren solo un script, un test o una modificación de un archivo.

## Criterio de entregado de toda la epic

Una solicitud de microfix y otra de proyecto completo recorren el mismo motor nativo con políticas distintas; el planificador selecciona checkpoints pertinentes; las tareas correctas reciben permisos, pruebas y presupuesto; el usuario puede reordenar/autorizar sin duplicaciones; la entrega final queda respaldada por evidencia y no se publica sin consentimiento.
