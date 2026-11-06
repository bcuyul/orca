# PR #33 — Atlas → Run/Task nativos, con autorización supervisada

## Prueba en Windows
1. Abrir Project Hub → Inteligencia y guardar el JSON generado por Atlas.
2. Aprobar el plan con justificación humana.
3. Inspeccionar la conversión a Orca Run/Task; verificar dependencias y SHA.
4. Pulsar «Crear Run/Task nativo (supervisado)».
5. Confirmar la ventana nativa de Orca; Cancelar no debe crear Run.
6. Comprobar el Run ID y cada Task ID en la misma pantalla.
7. Repetir el botón con mismo plan y HEAD: debe reutilizar Run/Task, no duplicarlos.

## Límite técnico
- Escritura real mediante NativePlanMaterializer, HostAdmissionLedger y OrchestrationDb.
- Proyecto, worktree, host local, Git HEAD y plan aprobado deben ser coherentes y verificarse dos veces.
- Se requiere árbol Git limpio; los árboles sucios o sin HEAD no pueden materializarse.
- El proceso main confirma con un diálogo de Electron; un boolean del renderer no autoriza.
- La reserva del ledger es persistente; una operación incompleta o incierta no se reintenta automáticamente.
- Los triggers de SQLite impiden un Dispatch de tareas staged, incluso desde rutas externas.
- No ejecuta Atlas/Forge/OpenCode/QA, no crea worktrees, no modifica Git, no hace push/merge ni auto-update.
- El siguiente paso exige el control de ejecución de un solo worker, vinculado a permiso verificado y presupuesto.
