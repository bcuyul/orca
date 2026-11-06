# PR #31: comprobación host-only para sesiones nativas

Este primer corte establece una función pura que exige inventario de sesiones del host, un único worktree inequívoco, una única pestaña de sesión y coincidencia exacta del agente/ID esperado. Rechaza inventarios inválidos, identidades duplicadas, snapshots no autoritativos, worktrees cruzados y proveedores inconsistentes.

El resultado confirmado concede únicamente base para navegación; executionAuthorized es siempre false. Ningún mensaje se envía, no hay sesión nueva, Run, Task, Dispatch, acceso a secretos, permisos o cambio persistente de Project Hub.

El adaptador de UI y la persistencia duradera deben esperar un recibo autenticado de host y comprobaciones de generación para no vincular sesiones obsoletas. No llamar desde UI a la ruta de reparación de pestañas con efectos secundarios.
