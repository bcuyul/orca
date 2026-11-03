# ADR propuesto: Decision Engine separado del Coordinator, autoridad en host

- **Estado:** Proposed — no aprobado/no implementado.
- **Fecha:** 2026-11-02.
- **Contexto:** `Coordinator` ejecuta DAG precreados; Project Hub registra propuestas/decisiones, y `agent.launchReplay` no demuestra finalización. Se requiere gestionar microtareas, casos de uso y proyectos con hitos y presupuestos, sin un segundo scheduler.

## Decisiones

**D1 — Un único motor de dispatch:** el Coordinator nativo conserva el control de Run/Task/Dispatch; `DecisionEngine` solo produce recomendaciones y conjuntos admisibles.

**D2 — Prioridad no es autorización:** scope, permisos, host identity, riesgo crítico, presupuesto y operaciones `unknown` son filtros duros antes de aplicar puntuación.

**D3 — MVP opcional:** `MilestonePolicy` decide si mostrar un MVP, caso de uso, integración o entregar directo. No forzar gate humano para microtareas sin riesgo.

**D4 — Dos Runs para proyecto multietapa:** la `DeliverySession` une Runs y evidencias, pero es un registro de producto, no un scheduler. Pausa con ningún **nuevo** dispatch autorizado mientras se espera decisión, y conciliación explícita de procesos activos.

**D5 — Pesos:** usar swing-weight MCDA con valores normalizados y validación de sensibilidad. Usar WSJF-like y FIFO como baselines. No usar AHP/TOPSIS/ML por defecto.

**D6 — Solver:** enumeración exacta solo como control de laboratorio; producción podría incorporar CP-SAT únicamente después de benchmark E2E. La incertidumbre de las estimaciones debe reflejarse en la selección.

**D7 — Kev:** clasificador opcional; `shadow mode` primero; no autoriza nada ni reemplaza pruebas. Evitar dependencia de GPU para el flujo esencial.

**D8 — Estado/recibos:** persistencia y CAS en ámbito transaccional del host; el Project Hub JSON es una proyección/versionado de propuestas y no forma una transacción distribuida con SQLite.

**D9 — Criterios de término:** cerrar si el objetivo está satisfecho y QA requeridas pasan, incluso con presupuesto sobrante. No reintentar fallos repetidos sin progreso.

**D10 — Publicación/privacidad:** no push, merge, deploy, creación de PR ni compartir memorias entre proyectos sin autorización específica.

## Alternativas descartadas y consecuencias

- **Segundo orquestador en Python:** mayor flexibilidad inicial, pero riesgos de doble dispatch, divergencia de permisos y replay.
- **Todo en `Coordinator`**: mayor acoplamiento de código crítico, difícil probar matemáticas aisladas.
- **Kev obligatorio**: hardware adicional, latencia y posibles errores no calibrados; mala experiencia para usuarios con una sola CLI.
- **Ponderación arbitraria como optimización:** matemáticamente ejecutable pero sin fundamento de preferencia; exige elicitación real.

## Invariantes a demostrar antes de activar agentes

1. Un plan aprobado **NO** lanza nada sin autorización de ejecución adicional.
2. Cada operación remota o CLI conserva su `operationId` y ningún `unknown` se reintenta a ciegas.
3. Repetir aceptación MVP/no duplicar Run V1.
4. Ningún score matemático puede habilitar tareas prohibidas, cambios de alcance ni merges.
5. Snapshot y evidencias vinculados a identidad y SHA; `PASS` no puede provenir solo de texto generado.
6. Presupuesto bloquea nuevos lanzamientos sin prometer detener costos anteriores.
7. Project Hub anterior sigue legible y PH-001 permanece sin tocar.

## Aceptación del ADR

Aprobar cuando los contratos de host/DB y la matriz de pruebas se diseñen para preservar invariantes 1–7; este documento por sí solo no autoriza implementarlos.
