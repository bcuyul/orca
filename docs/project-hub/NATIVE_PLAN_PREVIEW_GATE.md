# Project Hub → native DAG preview — PR stacked on #15

## User-facing vertical slice

1. Describe a product and request an Atlas JSON plan with existing Project Hub prompt (no CLI launch).
2. Import a bounded DAG (1–20 tasks) through the existing parser; ProjectHubStore persists it.
3. Human explicitly reviews, justifies and records the plan decision (not an execution grant).
4. Click **Inspeccionar conversión nativa (sin ejecutar)**.
5. The Electron IPC handler verifies trusted desktop renderer, registered Orca project,
   document revision and the plan from the authoritative host-side store.
6. A deterministic, read-only projection shows plan hash, dependency-first tasks and decision.
7. The existing **host-private** NativePlanMaterializer uses the same projection in its
   isolated SQLite tests, with an explicit test-only scope grant. It creates native
   Run/Task rows and never creates Dispatches or CLI workers.

This PR exposes **no** host grant, Run/Task mutation, Coordinator start, agent launch,
reviewer execution, push, merge, or deployment through the renderer. Plan approval is
not authenticated host execution approval. A worktree is **not** an OS sandbox.

## Acceptance and verification matrix

| Boundary | Evidence required |
| --- | --- |
| JSON → plan | Existing proposal parser and append-only ProjectHubStore tests |
| Persisted plan → decision | CAS/revision checks, explicit checkbox and justification |
| UI → host IPC preview | E2E isolated Electron test, stale revision refusal, project authorization |
| DAG → native Runs/Tasks (lab only) | Real SQLite test, dependency IDs, idempotent replay |
| Run/Task → Dispatch | Must remain blocked; verify zero Dispatch and coordinator_runs |
| Actual CLI, independent QA, deployment | Out of scope; never claim success |

Validation uses `src/main/project-hub/native-plan-preview.test.ts`, the existing
native-plan-materializer tests and `tests/e2e/project-hub-native-smoke.spec.ts`.
The inherited Project Hub integration CI runs on Windows and Ubuntu; the workflow
now also targets Draft PRs into `integration/project-hub-adaptive-clean`.

**CI pass not yet asserted.** Check the final commit SHA, four jobs, and a manual
Windows Electron smoke before considering this ready for review. The earlier PR #15
remains Draft, and `main` is untouched.

## Next controlled slice

Implement a host-owned, authenticated and scoped **materialization-only** approval
flow with durable reconciliation and real Coordinator ownership of the created tasks.
Only later consider an independent human execution authorization and verified OS
sandbox at the real CLI spawn boundary. Never auto-retry an unknown operation or
alter the pre-existing PH-001 unknown/unconfirmed launch.
