# Adaptive Delivery — laboratorio matemático aislado

**Estado:** prototipo offline, no runtime, no API de Orca, no IA, no red ni datos de proyectos. Node 22+; sin instalar paquetes.

## Comandos

```bash
node --test tools/adaptive-delivery-lab/decision-core.test.mjs
node tools/adaptive-delivery-lab/benchmark.mjs
```

En Windows PowerShell (desde la raíz del repo):

```powershell
node --test .\tools\adaptive-delivery-lab\decision-core.test.mjs
node .\tools\adaptive-delivery-lab\benchmark.mjs
```

`results.example.json` es un ejemplo generado, **solo con valores sintéticos**. El CLI imprime JSON; no crea archivos, no toca repositorios y no publica datos.

## Implementado realmente en este laboratorio

- Validador de DAG de 1–20 tareas, pesos, scores, duración/esfuerzo, permiso, estado de aprobación y estimación de éxito.
- Función aditiva de valor esperado `pSuccess * swingWeightedScore` (supuesto de ejemplo).
- Baselines FIFO y utilidad/efuerzo **WSJF-like**, no Cost of Delay económico genuino.
- Búsqueda exacta entre subconjuntos factibles (presupuesto/esfuerzo, obligatoriedad, permisos, dependencies).
- Planificación de lista **factible** según precedencias y roles. NO optimiza makespan; NO es RCPSP/CP-SAT.
- EVSI binario para decisiones con dos estados y señales simétricas de exactitud conocida.
- Pruebas Node para invariantes, casos imposibles, autorización humana y ejemplo EVSI.

## No implementado / límites

- No se han obtenido pesos por elicitación real ni calibrado probabilidades.
- No hay Agente Atlas/Claude/OpenCode, worktree, CI real, record de budget en host, seguridad runtime, scheduler integrado, aprendizaje estadístico ni Kev.
- Hasta 20 tareas → `2^20` combinaciones, suficiente para un **bench pequeño** pero no garantizar latencia interactiva ni scaling.
- La tarea `mandatory` se fuerza, `permitted=false` o `approval=pending|denied` se excluyen: si una tarea obligatoria queda no autorizada, el modelo devuelve `infeasible`.
- El algoritmo de asignación elige un schedule realizable y puede generar makespan subóptimo.
- El problema se modela como utilidad aditiva por historia. La dependencia de ejecución no equivale a sinergia del valor; en producción hay que modelar interacciones.

## Cómo leer benchmark

`exact`: mejor subconjunto del modelo simplificado; `fifo` y `wsjf` son heurísticas. `greedySchedule` es un calendario factible sobre dos roles, no prueba que la asignación sea óptima. Si un escenario muestra mayor utilidad optimizada, **no implica** mejora real de producto, costo o satisfacción.

## Política para integrar con Orca

No importar este módulo directamente en el proceso principal. Primero definir contratos tipados, autoridad del host y benchmarks de latencia/robustez; luego evaluar una versión implementada en `src/shared` con tests Vitest y la matriz Electron Windows/Linux.
