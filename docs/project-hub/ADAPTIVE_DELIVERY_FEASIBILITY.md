# Orca Adaptive Delivery — viabilidad y decisiones build/buy/defer

> Evaluación técnica de diseño, NO certificación de funcionamiento. Revisado contra la rama experimental del PR #5 el 2026-11-02; el laboratorio matemático es offline, no se conecta a la base de datos ni a CLIs.

## Criterios de viabilidad

- **Compatibilidad**: reaprovechar Orca `Run/Task/Dispatch`, identidad de host/proyecto/worktree, Project Hub existente y autorización RPC.
- **Costo**: dependencias, GPU, llamadas a proveedores, mantenimiento, integración y pruebas.
- **Riesgo**: privacía, falsa validación de CI/QA, incertidumbre de ejecución, sesgo de prioridad, sobregasto.
- **Calidad de datos**: distinguir dato medido, estimado, juicio humano y desconocido.
- **Salida**: una implementación mínima comprobable, una ruta de actualización y criterios de salida.

## Matriz de viabilidad

| Capacidad | Viabilidad | Dependencias / costo | Riesgos críticos | Decisión |
| --- | --- | --- | --- | --- |
| Clasificador por escala (microfix, caso, módulo, proyecto, investigación) | Alta como heurística con override humano | Pocos contratos TS | Clasificación errónea en cambios pequeños de alto riesgo | **Implementar** reglas/registro primero |
| Swing MCDA | Alta como función pura, **pesos requieren elicitación** | Sin dependencia externa | Subjetividad, doble conteo, violar independencia | **Implementar** puntuación explicable y sensibilidad |
| AHP | Media | Interfaz de comparaciones, análisis consistencia | Fatiga de comparaciones, rank reversal | **Opcional** para decisiones mayores |
| TOPSIS | Media | Normalización y criterios | Rank reversal, sensibilidad de escala | **Solo comparar** en benchmarks |
| WSJF / costo de demora | Alta como heurística; economía requiere datos | Definición CoD y duración | Confundir utilidad arbitraria con dinero/CoD | **Baseline** hasta observar CoD |
| Enumeración exacta de subconjuntos <=20 | Alta en laboratorio, variable en runtime | Exponencial 2^n | Latencia, utilidad aditiva ficticia | **Solo experimento** / hard bound y timeout |
| OR-Tools CP-SAT / RCPSP | Media | Solver externo/packaging, modelo de recursos/roles | Superficie de instalación, calendario ficticio por duraciones erradas | **Diferir** hasta evidencias y E2E |
| VOI / EVSI | Alta para cálculos discretos; baja sin probabilidades | Distribuciones confiables, costo de información | Falsa precisión | **Modo asesor**, nunca elimina gates obligatorios |
| Regresión duración y éxito | Media-baja ahora | Telemetría limpia, muestras y cohortes | Bias, overfit, drift, fuga entre proyectos | **Registrar datos**, entrenar después |
| Bradley–Terry preferencias | Media-baja ahora | Comparaciones humanas suficientes | Preferencia ≠ beneficio causal | **Diferir** |
| Kev local | Media técnica; hardware desconocido | Python 3.12/3.13, uv, pesos + GPU/RAM o CPU lenta | Consumo y mala calibración fuera de distribución | **Shadow mode opcional**, benchmark A/B |
| BudgetGuard sin gastos exactos | Alta para invocaciones; condicional para tokens/USD | Adaptadores CLI y usage cuando exista | Cuotas externas no reportadas, procesos activos | **Implementar** con calidad de dato explícita |
| ScopeGuard / human gate | Alta como host contract | RPC, CAS, ledger, tests de seguridad | Escalada de permisos por texto no confiable | **Obligatorio antes de agentes autónomos** |
| Evidence/QA independiente | Media | Hashes, CI real, aislamiento revisor | Falsos PASS o evidencia obsoleta | **Implementar** con verificaciones nativas |
| MVP/V1 y checkpoints adaptativos | Media | Run lifecycle + milestone store + idempotencia | Cross-store consistency, double launch, cancelación insegura | **Implementar por incrementos** |

## Kev: opciones concretas

1. **Sin Kev (por defecto)**: determinista, rápido, no requiere GPU, mantiene máxima reproducibilidad.
2. **Kev shadow mode local**: pregunta clasificación y registra predicción sin influir en dispatch; medir precisión/calibración por tipo y idioma, memoria/latencia, y porcentaje de escalaciones.
3. **Kev asesor**: usar recomendaciones solamente si pasa benchmarks comparativos y umbrales calibrados; guardrails del host siempre gobiernan.
4. **Kev alojado**: fuera de alcance inicial por privacidad/costo de uso remoto y consentimiento; evaluar separadamente.

Kev expone `POST /v1/systemone` y devuelve elección, probabilidades y su definición de confianza. **Esa confianza NO es la probabilidad empírica de acierto**. Su instalación viene del repo (no `pip install kev`, que corresponde a otro paquete). [Repositorio y API](https://github.com/jaredpalmer/kev). La licencia declarada es Apache-2.0, pero modelos, datos y dependencias merecen revisión específica en cada versión.

## Tres alternativas de arquitectura evaluadas

| Opción | Ventaja | Desventaja | Decisión |
| --- | --- | --- | --- |
| A. Otro scheduler Python independiente | Prototipado flexible | Duplica estado, permisos y dispatch; alto riesgo de inconsistencia | **Rechazar** |
| B. Extender `Coordinator` con toda la lógica | Una superficie de ejecución | Acopla matemática/UX/decisiones a un loop sensible | **Rechazar** como monolito |
| C. Servicios de admisión/decisión puros + Coordinator nativo | Reutilización, pruebas, host authority | Requiere puente seguro y ledger | **Elegida** |

## Viabilidad por plataforma

- **Windows (primera plataforma):** Node/TypeScript y Electron ya soportados en Orca. Tests del laboratorio `node:test` sin dependencias. CP-SAT y Kev no se incluyen por defecto.
- **Linux:** ejecutar CI equivalente y smoke real de CLI; no extrapolar resultados de Node a Electron o worktrees reales.
- **SSH/remote:** bloqueado hasta probar enlace RPC, permisos/identity remota, reconexión y reconciliación de operaciones inciertas.
- **Mac:** compatibilidad esperable por base del producto; **no validada para esta propuesta**.

## Riesgos y mitigaciones

| Riesgo | Severidad | Mitigación / test |
| --- | --- | --- |
| Lanzamiento duplicado luego de timeout/restart | Crítica | Receipt + idempotency key; `unknown` impide retry; crash matrix |
| Scope creep por agente | Alta | Contratos del host y manifiesto de scope; tests de rutas/repos/operaciones |
| QA falso o stale | Alta | Evidence hash + identidad de reviewer + CI verificada |
| Pesos arbitrarios optimizados como si fueran verdad | Alta | Elicitación, intervalos, sensibilidad y human override |
| Cuotas de proveedor no medibles | Alta | Límites por invocación, telemetría marcada y reserva conservadora |
| Optimización bloquea UI | Media | Bound estricto + servicio separado + timeout/cancelación |
| Riesgo privado/datos en prompts | Crítica | Restricciones por proyecto, redacción, revisión de destino, no auto-publicar |
| Sesgo hacia historias cortas | Media | Métricas de entrega end-to-end, tareas obligatorias, dependencies |
| Predicción descalibrada | Media | Baseline, backtesting, Brier, cohortes y revisión humana |

## Criterios de habilitación progresiva

**Gate 0 — docs/lab:** comprobar fuentes, pruebas sintéticas, compatibilidad y seguridad estática. Este paquete **solo** cumple esta clase de entrega; no se debe inferir integración a host.

**Gate 1 — contrato host:** autorizar nuevos Runs con presupuesto y scope, sin worker real; pruebas de replay/cancel/host wrong/unknown.

**Gate 2 — flujo real:** caso de uso nuevo llega a Run/Task/Dispatch con worker local y pruebas verificadas (no texto declarado).

**Gate 3 — autonomía:** bloqueos, reparación, QA independiente y milestones recuperables probados en Windows/Linux.

**Gate 4 — optimización:** comparar política base vs política optimizada con la misma definición de aceptación; habilitar solo si no degrada seguridad/calidad y produce mejora reproducible.

## Métricas clave

- Tiempo desde solicitud hasta primer resultado funcional aceptado (TTFV) y hasta entrega final.
- Historias verificadas/tiempo de worker, defectos regresivos, QA en primer intento y retrabajo.
- Llamadas a modelo y tokens cuando expuestos; `dataQuality=actual|estimated|unavailable`.
- Fallos de CAS, tareas duplicadas, operaciones inciertas relanzadas (objetivo cero).
- Nivel de intervención humana **necesaria**, no número de prompts emitidos.
- Benchmark cruzado por stack, tipo de historia y riesgo; reportar intervalos y tamaños de muestra.

## Puntos NO resueltos

- Esquema definitivo y tablas nativas de autorización/budget/checkpoints.
- Proceso de cierre/pausa cuando todavía hay workers activos o remotos.
- Cómo parametrizar costo de demora real en distintos proyectos.
- Presupuestos monetarios exactos en CLIs con licencia de suscripción.
- Pruebas de sandbox para QA con capacidades reales de SO.
- Datos etiquetados suficientes para regresión o modelos de decisión de Kev.

No habilitar automatismos en PR de documentación por omisión de estos puntos.
