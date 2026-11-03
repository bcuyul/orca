# Project Hub — Atlas → Forge → QA handoff panel (Draft)

This stacked PR renders the bounded, append-only evidence model from the
previous PR inside the **Inteligencia** tab.

## Manual workflow

1. Import an Atlas DAG and record explicit human plan approval.
2. Select a Forge/Flow/Data task in the new **Atlas → Forge → QA** panel.
3. Provide the 40-character base SHA and copy the non-executable Forge
   task brief to an independently user-controlled external session.
4. After external work, enter the resulting head SHA, diff reference and
   claimed test results. Orca stores these as **external-unverified**.
5. QA chooses a precise report ID and a different *declared* reviewer label,
   inspects the diff independently and records findings. Neither actor is
   authenticated by the renderer and CI has not been verified here.
6. If another commit is submitted, an earlier QA verdict stays attached
   to the old report and the task returns to **Pendiente de QA**.

## Optimization and safety

- Only the selected plan is projected and shown (maximum 20 tasks),
  instead of rendering all 30 stored plans × 20 tasks at once.
- The shared projection indexes evidence and reviews with Maps/Sets, avoiding
  nested repeated scans. React useMemo prevents recomputation for unchanged
  document data and selected plan.
- ProjectHubStore enforces revision CAS and append-only evidence; the
  renderer never receives access to host admission or native mutations.
- No IPC grant, CLI execution, Dispatch, Coordinator, sandbox permission,
  remote CI claim, deployment, merge, or agent self-approval.
- **QA approved (declared)** is not equivalent to verified QA or a successful CI.
- Legacy QA notes remain available but are explicitly marked legacy, and
  do not satisfy the linked-review readiness gate.

## Tests

Playwright Electron covers a real isolated project profile:
plan import/approval → external evidence → linked QA → persisted reload →
execution blocked. Windows/Ubuntu Oxlint, Vitest, typecheck and Electron
smoke required before merging.

**No merge until CI and independent review pass.**
