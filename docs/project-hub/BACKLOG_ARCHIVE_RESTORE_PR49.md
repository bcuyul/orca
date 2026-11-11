# PR #49 — Quitar y restaurar historias del Backlog sin perder trazabilidad

## Necesidad

En Orca el Backlog permite agregar historias y cambiar su estado, pero no
ofrece cómo quitar un registro erróneo. Borrar la fila podría reutilizar
`PH-001` y romper referencias históricas de planes, tareas, delegaciones,
auditoría, QA o Run/Task en SQLite.

## Experiencia de usuario

- En `Project Hub → Backlog` los elementos `Backlog` o `Ready`
  muestran `Quitar del backlog`.
- La primera pulsación **solo despliega una confirmación**.
- `Cancelar` mantiene la historia intacta.
- `Confirmar quitar` la oculta de las listas activas y la conserva con
  `archived: true`, incluyendo su ID, estado y vínculos.
- La sección `Quitados del backlog` muestra los registros ocultos,
  con botón `Restaurar`.
- Restaurar vuelve a mostrar el mismo ID y el mismo estado original.

Se trata de una retirada **reversible**, no eliminación física. Los datos
existentes siguen siendo válidos, incluso para un plan aprobado y Run materializado.

## Controles de host

- El contrato de documento schema-1 acepta opcionalmente `archived: boolean`,
  manteniendo compatibilidad con documentos antiguos.
- `ProjectHubStore.save` impide que una actualización desde el renderer
  haga desaparecer IDs de historias ya persistidas. El control usa la
  revisión existente para evitar escrituras antiguas.
- Un elemento archivado no se ofrece para un DAG nuevo, una delegación nueva
  ni una asociación nueva de Backlog ↔ DAG.
- Los enlaces históricos y los IDs quedan preservados.
- Las métricas de Backlog activo omiten los registros archivados.
- No se modifican Run, Task, Dispatch, CLI, agentes ni permisos.

## QA

- Vitest del cambio reversible, referencias, plan sin IA, IDs estables,
  rechazo de archivados no elegibles y contrato schema-1.
- Prueba de persistencia en `ProjectHubStore`: impide borrado físico,
  archiva, recupera y restaura usando escritura del host.
- Electron smoke Windows/Ubuntu: crear → solicitar quitar → cancelar →
  confirmar → comprobar persistencia tras desmontar la UI → restaurar.

El cambio no consume tokens de modelos ni modifica un repositorio del usuario.
En pruebas manuales, la retirada se realiza exclusivamente dentro del
documento de Project Hub del proyecto seleccionado.
