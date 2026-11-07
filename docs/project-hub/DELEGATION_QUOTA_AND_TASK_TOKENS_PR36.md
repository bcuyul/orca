# Project Hub — cuota del proveedor y tokens por tarea

Este incremento añade un planificador de carácter orientativo a la pestaña Orquestación → Planificación de delegaciones. No cambia autorizaciones ni Dispatch.

## Antes de preparar una delegación

- Orca lee su estado nativo de uso de cuota de Codex o Claude desde el store de rate limits si es reciente y pertenece al host local.
- Muestra porcentajes consumidos y restantes por ventana temporal disponible (sesión, semana y mes). Si falta la fuente, el host no coincide, los valores son obsoletos o el proveedor es OpenCode/Hermes sin cuenta universal, indica cuota no verificable.
- Una cuota temporal en porcentaje no se puede convertir automáticamente a tokens disponibles. Nunca confunde tokens de contexto con capacidad de suscripción.
- Estima cada tarea con un piso aproximado del texto (caracteres / 4) más un escenario de esfuerzo explícito: pequeño +6.000, mediano +18.000 o grande +45.000 tokens. El usuario puede modificar el total por tarea.
- Un presupuesto opcional del lote, introducido por el usuario, permite ver qué porcentaje representa cada tarea y cuánto suma el lote.
- Al preparar, guarda un objeto tokenEstimate por delegación con totalTokens, promptTokens, scenario y source; el campo es inmutable como el resto de la identidad de la delegación.
- No mide gasto real, no ejecuta agentes, no impone un límite de runtime y no autoriza sesiones.

## Límites

- Para OpenCode y Hermes hay que vincular proveedor, modelo y cuenta con la sesión/host antes de atribuir métricas.
- Medición de consumo real por tarea requiere recibos de sesión y atribución verificada a Run/Task. La cuota de proveedor no permite reconstruirlo.
- La estimación puede subestimar uso de herramientas, contexto de repositorio, pruebas, subagentes y reintentos.
- La calibración con históricos debe hacerse solo sobre sesiones cuya identidad haya sido corroborada.
