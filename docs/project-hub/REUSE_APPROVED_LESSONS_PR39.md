# Project Hub — reutilizar y revocar lecciones aprobadas (PR #39)

## Qué cambia

Reutiliza la persistencia y las decisiones humanas **ya disponibles** en Project Hub → Inteligencia. No crea un segundo registro de memoria ni lee los archivos de perfiles de Hermes.

1. En **Inteligencia → Forge · memoria con evidencias**, una persona propone una lección corta (máximo 220 caracteres), selecciona el perfil (o todos), asigna de una a ocho etiquetas simples y adjunta una referencia declarada `commit:<sha40>`.
2. La propuesta **no** entra automáticamente en prompts: una persona debe aprobarla y justificar su decisión mediante el mecanismo existente.
3. Al renderizar una tarea para un CLI distinto de Hermes, Project Hub transforma únicamente memorias aprobadas con formato `profile=forge;tags=sqlite,persistence` y referencia válida, y selecciona **a lo sumo dos**, dentro del límite de 480 caracteres establecido en el PR #38.
4. Cuando una lección resulte incorrecta, se puede **revocar** con nueva justificación y confirmación; su aprobación queda en el historial append-only, pero la lección ya no aparece en futuros prompts.
5. El CLI Hermes no recibe este bloque redundante: su memoria de perfil sigue bajo control de Hermes. No se importan ni escriben `MEMORY.md` ni `USER.md`.

## Límites y seguridad

- El prefijo `commit:` y la aprobación son **declaraciones humanas**: Orca todavía no valida ese commit contra Git/CI ni atribuye una sesión al agente.
- Los registros heredados con aplicabilidad libre siguen legibles, pero no se reutilizan hasta presentarlos como una nueva propuesta explícita en formato acotado.
- No existe autorización nueva para Runs/Dispatches, lanzamiento de CLIs, escritura en Hermes, Git push o merge.
- La delegación del Centro de ejecución puede permanecer deshabilitada por políticas del host; esta mejora no la habilita.
- No se generan memorias automáticamente a partir de errores de agentes: siguen siendo candidatas revisadas por humanos.

## Verificación

Revisar pruebas de aprobación, revocación, persistencia append-only, selección, aislamiento de rol/proyecto y prompts sin duplicación para Hermes; luego matriz Windows/Ubuntu/Electron.
