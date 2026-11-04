# Métodos matemáticos verificables para decisiones de Orca

> Investigación documentada (2026-11-02). Fórmulas basadas en literatura; parámetros de ejemplo **hipotéticos** y nunca calibrados con telemetría de Orca.

## 1. Definir el problema correcto antes de optimizar

- **Viabilidad**: ¿está autorizada la tarea? ¿es necesaria? ¿tiene dependencias disponibles? ¿hay presupuesto? Son restricciones duras, no pesos.
- **Valor**: ¿qué beneficio incremental ofrece la tarea al objetivo? Preferencia humana con incertidumbre.
- **Selección**: ¿qué conjunto de tareas cabe en recursos y precedencias?
- **Programación/asignación**: ¿en qué orden y con qué worker se realizan?
- **Decisión epistémica**: ¿conviene pedir información, experimentar, continuar o detener?

No agregar sin más seguridad, complejidad, riesgo, valor y prioridad en un solo número. Riesgos críticos y permisos no son compensables por un beneficio alto.

## 2. MCDA y swing weighting: el valor

Modelo de utilidad aditiva: `V_i = sum_j w_j v_j(x_ij)` con `w_j >= 0`, `sum(w)=1`, escalas cardinales comunes y criterio de independencia de preferencias. Los pesos se **elicitan por swing**, comparando el valor de mover cada criterio del peor al mejor nivel relevante, no por el nombre de los criterios. Ejemplo ordinal de swings `100,60,40` → pesos `0.50,0.30,0.20` (NO pesos validados). Sensibilidad: perturbación de pesos/escenarios, rango de rankings, identificación de alternativas dominadas.

Para tareas de software la valoración debe ser **incremental sobre resultados** y considerar complementariedad entre tareas. Si `unlock` refleja el valor aguas abajo, evitar duplicarlo al valorar tanto prerequisito como descendientes; en ese caso modelar beneficios conjuntos o solo usar unlock como heurística de orden.

Fuentes: [Gobierno británico: MCDA y swing weighting](https://www.gov.uk/government/publications/green-book-supplementary-guidance-use-of-multi-criteria-decision-analysis/use-of-multi-criteria-decision-analysis-in-options-appraisal-of-economic-cases), [Green Book 2026](https://www.gov.uk/government/publications/the-green-book--2/the-green-book-2026). Nota: Green Book diferencia MCDA riguroso del simple «peso x puntuación» arbitrario.

## 3. AHP / TOPSIS / WSJF: opciones, no verdad universal

- **AHP**: comparación recíproca `a_ij`, vector de prioridades del autovector principal `Aw = lambda_max w`; `CI=(lambda_max-n)/(n-1)`, `CR=CI/RI`. Las preferencias pueden ser inconsistentes y AHP introduce esfuerzo de elicitación. Modo avanzado, no por defecto. [Saaty, 1987](https://doi.org/10.1016/0270-0255(87)90473-8).
- **TOPSIS**: cercanía al ideal `C_i=d_i^-/(d_i^++d_i^-)`. Adecuado como comparador en una lista fija; sensible a normalizaciones y alternativas añadidas, por lo que no usarlo como fuente única del backlog dinámico. [Saaty: ranking y rank reversal](https://doi.org/10.1111/j.1540-5915.1987.tb01514.x) documenta el fenómeno en AHP, no es evidencia directa de TOPSIS.
- **WSJF (SAFe)**: `WSJF_i = relative Cost of Delay_i / relative Duration_i`. Es heurística económica para ordenar trabajo, no un solver de DAG ni de presupuesto. [SAFe oficial](https://framework.scaledagile.com/wsjf/).

El laboratorio contiene un baseline **WSJF-like** de utilidad/efuerzo (no una estimación económica genuina de Cost of Delay): se usa como control experimental, nunca etiquetarlo «WSJF real» sin datos de demora.

## 4. Selección por programación entera

Para cada tarea `i`, `x_i` binaria. Maximizar `sum_i u_i x_i`, sujeto a:

- Presupuesto `sum_i c_i x_i <= B`.
- Precedencia de selección `x_j <= x_i` cuando `j` requiere `i`.
- Tareas obligatorias `x_m=1`, prohibidas `x_p=0`.
- Capacidad y disponibilidad según agente/host.

Para un conjunto heurístico `H` y el óptimo del **mismo modelo** `O`, la brecha absoluta es `Delta = V(O) - V(H) >= 0`, y la relativa es `100 * Delta / V(O)` (si `V(O) = 0`, se define 0%). Una brecha 0% solo certifica coincidencia de objetivos para las hipótesis y datos introducidos, no calidad de esos datos ni programación de agentes.

Un modelo más realista representa beneficios de conjuntos, escenarios de éxito y costos de reintento. Utilidad esperada simple `p_i * V_i` requiere hipótesis fuertes sobre éxito y aditividad; no representa por sí sola la probabilidad conjunta de completar un flujo.

**Project Hub (PR #26)** usa enumeración exhaustiva de los `2^n` subconjuntos solo para DAG de **1 a 12 tareas** (máximo 4096). Maximiza el valor MCDA aditivo con esfuerzo y precedencias estrictas, incluido el conjunto vacío; desambigua por menor esfuerzo y orden estable. Con 13–20 tareas conserva FIFO y la heurística valor/esfuerzo, pero omite el benchmark exacto. Complejidad `O(2^n*n)`: no es un solver general, no optimiza el calendario de workers ni acredita autorización o éxito operacional. Los valores, pesos y presupuestos son estimaciones humanas.

## 5. Programación con recursos (RCPSP)

Con `s_i` comienzo y `d_i` duración, precedencias `s_j >= s_i+d_i`; restricciones de capacidad limitan solapamientos en cada recurso. Problemas combinatorios habituales incluyen recursos alternativos y duraciones inciertas. Para uso productivo estudiar OR-Tools CP-SAT con intervalos opcionales, `NoOverlap` y `Cumulative` sobre perfiles medidos.

Fuentes: [Hartmann y Briskorn, 2022](https://doi.org/10.1016/j.ejor.2021.05.004), [OR-Tools scheduling](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md).

**Este laboratorio no usa CP-SAT**. Su `listSchedule` produce un calendario factible bajo las competencias del worker y precedencias; el orden de lista no necesariamente minimiza makespan.

## 6. VOI / EVSI para decidir preguntas y experimentos

`EVSI = E_Z[max_a E[U(a,theta)|Z]] - max_a E[U(a,theta)]`. Investigar cuando `EVSI - cost_of_information > 0` **solo para decisiones permitidas sin gate legal o de seguridad**. Estimación requiere distribuciones calibradas y especificar fiabilidad/costo de la señal.

Ejemplo sintético exacto: escenario alto/bajo 50/50, acción A `[100,20]`, acción B `[60,50]`, prueba de 80% de acierto simétrico, costo 3:
- Valor actual = 60; valor tras señal = 68; EVSI = 8; neto = +5.
- No significa que preguntar siempre sea bueno: una pregunta al usuario tiene latencia y costo de atención, además de beneficio informativo.

Fuente: [Heath et al., EVSI practical guidance](https://pmc.ncbi.nlm.nih.gov/articles/PMC8183576/).

## 7. Econometría y calibración: activar después de reunir datos

- Duración: `log(T_i)=beta_0+beta^T X_i + eps_i` es una especificación candidata, no modelo estimado.
- Éxito: `P(Y_i=1|X_i)=sigmoid(beta_0+beta^T X_i)`. Requiere definición estable de `Y`, variables de contexto y validación temporal.
- Brier score binario: `BS=mean((p_i-y_i)^2)` para evaluar pronósticos, con validación fuera de muestra y análisis de calibración. [Brier (1950)](https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml).
- Preferencia pareada: Bradley–Terry `P(i>j)=exp(theta_i)/(exp(theta_i)+exp(theta_j))`, cuando haya suficientes comparaciones humanas no sesgadas. [Bradley y Terry (1952)](https://academic.oup.com/biomet/article-abstract/39/3-4/324/326091).
- Cambios de política sobre logs históricos no implican estimación causal fiable. Para evaluación off-policy considerar muestreo, propensity y estimadores doubly robust solo si se diseñó la recolección adecuada. [Dudík, Langford y Li (2011)](https://www.microsoft.com/en-us/research/publication/doubly-robust-policy-evaluation-and-learning-2/).

Sin dataset representativo, usar priors inciertos, rangos y sensibilidad; **nunca presentar probabilidad generada por LLM/Kev como frecuencia de éxito calibrada**.

## 8. Reglas de admisión y detención

```
Eligible(task) = scope_authorized AND permissions_granted
                 AND dependency_gate_passed AND budget_reserved
                 AND worker_capable AND dispatch_state_reconciled

Continue = unfinished_authorized_objective AND measurable_progress
           AND budget_available AND no_unresolved_hard_gate
```

Las fórmulas de utilidad **no sustituyen** los guardrails. Si hay bloqueos críticos, parada segura con evidencia. Si un intento no reduce errores, no volver a enviar el mismo prompt indefinidamente. Si se cumple el objetivo autorizado, concluir aunque quede presupuesto.

## 9. Política recomendada por tamaño de tarea

| Solicitud | Valorización | Selección / secuencia | Predicción | Gate |
| --- | --- | --- | --- | --- |
| Microfix | Riesgo + reglas | No solver | No requerido | Sólo si material |
| Caso de uso | MCDA ligera | Topológico / heurístico | Estimación simple | Demo funcional opcional |
| Módulo | Swing + sensibilidad | Subset exacto pequeño | Intervalos conservadores | Integración / riesgos |
| Proyecto amplio | MCDA + optimizador, revisar robustez | CP-SAT futuro + replanning | Modelos validados si existen | Checkpoints adaptativos |

No recomendar un algoritmo por su complejidad matemática; medir superioridad frente a FIFO, WSJF-like y reglas de negocio.
