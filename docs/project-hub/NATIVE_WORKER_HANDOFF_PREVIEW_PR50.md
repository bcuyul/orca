# PR #50 — Traspaso verificado Run/Task → sugerencia de CLI (sin tokens)

## Avance tangible

Hoy Project Hub materializa un Run/Task verificado en SQLite, conserva el
Dispatch en cuarentena y detecta agentes nativos, pero esos tres datos
estaban separados en la interfaz.

En `Project Hub → Inteligencia → Inspeccionar conversión nativa`, el panel
**Traspaso Run → CLI · solo propuesta** enlaza:

- Proyecto y plan **aprobados**, misma revisión y SHA de vista previa.
- Recibo de **un único** Run/Task en SQLite conciliado por el host.
- **Una sola** tarea raíz Forge/Flow/Data, sin dependencias.
- QA y demás tareas dependientes permanecen listadas como *en espera*.
- HEAD base del worktree del recibo de materialización.
- Inspección previa de Dispatch que debe ser `not_found`; estados inciertos
  o reservas existentes bloquean la propuesta.
- Inventario nativo Orca de CLIs **detectados y habilitados** en el contexto
  local; orden nativo por defecto y elección explícita disponible.
- Encargo de implementación con Run ID, Task nativa, SHA base y criterios,
  construido reutilizando la serialización de datos no confiables del
  renderer de handoff existente. El operador puede copiar el texto.

El panel NO crea sesión, worktree ni Dispatch, NO invoca modelos, no concede
permisos ni escribe evidencias. La sugerencia de CLI solo refleja el
inventario local, **no** autentica una sesión o un proceso.

## Contrato que sigue bloqueado

- La aprobación del plan no concede permiso para gastar tokens.
- La inspección de Dispatch debe existir y estar libre de reservas:
  `reserved_unobserved`, `settled_unverified` y
  `needs_reconciliation` no producen instrucciones.
- Si el Run no está verificado, faltan CLI o SHA, o hay varias tareas raíz,
  el borrador queda bloqueado.
- Nunca se enruta la QA como tarea raíz ni se confunden sus dependencias con
  una implementación terminada.
- Incluso cuando hay encargo copiable, `executionAuthorized:false`,
  `sessionVerified:false` y `modelCalls:0`.

## Cómo lo probaremos

Después de integrar el PR y abrir un Project Hub de laboratorio:

1. Inspeccionar un plan **pendiente**: ver traspaso bloqueado, sin encargo.
2. Aprobar plan y preparar Run/Task bajo ventana nativa.
3. Inspeccionar **Dispatch** y observar `Sin reservas`.
4. Consultar la propuesta: Run ID y Task ID correctos, CLI detectado
   sugerido y QA `review` en espera de `implement`.
5. Elegir otro CLI detectado: solo cambia el texto/sugerencia, no la tarea.
6. Copiar borrador: clipboard, ningún proceso iniciado y ningún Dispatch nuevo.
7. Deshabilitar o quitar todos los CLI: el encargo desaparece y se explica
   qué inventario falta.
8. Un Dispatch incierto bloquea la propuesta en las pruebas unitarias,
   sin reintento ni consumo de otra cuota.

```powershell
pnpm exec vitest run --config config/vitest.config.ts src/shared/project-hub-worker-handoff-preview.test.ts
pnpm typecheck
```

CI incluye lint, regresiones nativas y smoke Electron Windows/Ubuntu.

## Después de este PR

Para dejar atrás el clipboard y automatizar Atlas → Forge → QA **sin saltar
seguridad**, el siguiente corte será un bridge host-owned de sesión nativa
con sandbox OS verificable y soporte de cancelación/confirmación de entrega.
Solo después podremos enviar un turno, comprobar coste real y despachar QA
con evidencia de commit y tests. No habilitar auto-retry de prompts inciertos.
