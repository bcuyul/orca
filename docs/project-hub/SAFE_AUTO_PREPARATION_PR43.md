# PR #43 — Preparación automática supervisada, sin tokens

La meta es reducir a un clic el tramo seguro del flujo de Project Hub sin
inventar un segundo Coordinator, un daemon ni permisos otorgados por React.

## Flujo de un clic

En `Project Hub → Inteligencia`, después de aprobar manualmente un plan,
`Preparar plan automáticamente (supervisado)` hace:

1. Ejecuta el laboratorio sintético sobre SQLite temporal. Si falla, aborta.
2. Solicita una nueva vista previa desde Electron main (revisión, DAG y SHA).
3. Inspecciona los recibos nativos de ese mismo plan/worktree.
4. Si el Run ya está verificado, lo reutiliza sin crear ni duplicar tareas.
5. Si no existe Run, solicita **autorización humana independiente en la ventana
   nativa de Orca** y usa el materializador host-only ya instalado.
6. Verifica de nuevo el Run/Task y las dependencias en SQLite.
7. Muestra el diagnóstico de tareas raíz y bloqueadas y deja
   `executionAuthorized=false`, `dispatchAllowed=false`.

El modo **manual** (inspeccionar, materializar, recuperar) sigue disponible.
No se exige volver a hacer clic en esos controles cuando la ruta guiada tiene
éxito. El botón aparece solo para un plan aprobado en un proyecto local.

## Invariantes

- Ninguna aprobación de plan habilita ejecución de agente.
- Todas las llamadas siguen los canales Electron ya protegidos por
  ventana/Project.id local, identidad Git y hash/revisión del plan.
- La única escritura posible es Run/Task en cuarentena vía
  `stageHubNativePlan`. Nunca Dispatch ni procesos.
- Los recibos `unknown`, `multiple_verified` y divergentes requieren
  conciliación manual; **no se relanzan automáticamente**.
- Si el diálogo es cancelado, no se hace un segundo intento.
- El laboratorio no accede a datos reales ni consume cuota de modelos;
  sus resultados sintéticos no son QA de código ni CI del proyecto.
- Los permisos de CLI siguen ausentes: no se disfraza de automatización
  completa de Forge/QA.

## Pruebas y evidencia

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/shared/project-hub-safe-auto-preparation.test.ts src/main/project-hub/offline-coordinator-lab.test.ts
pnpm exec oxlint src/shared/project-hub-safe-auto-preparation.ts src/shared/project-hub-safe-auto-preparation.test.ts
pnpm typecheck
```

El CI de Clean Project Hub Integration incluye suites `src/shared/project-hub`,
Electron smoke en Windows y Ubuntu. Mantener el PR en Draft hasta aprobar
ambas matrices y revisar la interacción completa en un proyecto de prueba.

## Próximo corte de automatización real

1. Abrir una decisión de **ejecución** diferente de la aprobación del plan:
   una sola tarea, un turno, presupuesto y SHA/worktree exactos.
2. Usar `HostExecutionPermitStore` existente solo si el host verifica
   sandbox OS real. El worktree Git no es un sandbox.
3. Consumir de forma atómica permiso + Dispatch, con operación idempotente,
   rechazo por cuotas y reconciliación de `unknown`.
4. Conectar una única sesión CLI/terminal nativa y capturar evidencia real.
5. QA independiente y PR propuesto sin auto-merge, con escalado por riesgo.

No integrar directamente el Draft #12 (apilado en ramas experimentales):
reutilizar solo contratos compatibles con `main` y añadir pruebas propias.
