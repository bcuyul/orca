# Project Hub / Adaptive Delivery — security and desktop release gate

Date: 2026-11-02. Applies to PR #15 on `integration/project-hub-adaptive-clean`.

## Security scope and disposition

**Decision: allow planning-only experimentation; do not authorize live agent
execution or release from these tests.** The Electron UI, backlog, local
persistence, synthetic admission/materialization and isolated tests are in
scope. A real host-authenticated worker-launch authority is **not** in scope.

| Boundary | Source reviewed | Evidence / decision |
| --- | --- | --- |
| Project Hub IPC | `src/main/ipc/project-hub.ts` | Main-window webContents ID and existing Orca Project identity checked before read/save. This is not a substitute for a renderer integrity assessment. |
| Project storage | `src/main/project-hub/project-hub-store.ts` | Hashed filenames, bounded document size, revision CAS, append-only approvals, and document validation. |
| Launch receipts | `src/main/project-hub/project-hub-store.test.ts` | Previously the renderer could persist `planned → launching → launched` with unverified handles. The store now refuses all renderer-authored changes to existing launch status, worktree ID, terminal handle and warning. Existing historical rows remain readable. |
| CLI dispatch | `src/main/runtime/rpc/methods/agent-launch.ts` | Project Hub UI no longer calls `agent.launchReplay`; the extra reject guard uses caller-controlled `launchSource` only. It **cannot** authenticate the caller and is not an OS sandbox. Existing manual launch paths remain separate. |
| Native staged plans | `host-admission-ledger.ts`, `coordinator-task-scope.ts`, `adaptive-staged-task.ts` | Staged tasks are excluded from Coordinator and SQLite Dispatch inserts/retargets are fenced by provenance triggers once the host ledger is initialized. Regressions test direct SQL and restart. |
| Prepared execution permit | `host-execution-permit.ts` | Requires host-side decision/worktree readers, scope and plan identity, and sandbox evidence; returns `dispatched: false`. Host decision readers are currently **abstract**, exercised with fakes in tests. |
| Sandbox | `execution-sandbox-policy.ts` | Rejects worktree-only and malformed evidence. No production Linux namespace/container/Windows AppContainer enforcement has been demonstrated or wired into the actual CLI launch. The preflight itself states launch-time enforcement is still required. |

## Release blockers

1. **Live agent launching: BLOCKED.** Implement real host-authenticated, auditable
   approval and revocation. A renderer checkbox or plan decision must not grant
   permission to execute processes.
2. **Sandbox enforcement: BLOCKED.** Establish OS-enforced filesystem, network
   and child-process restrictions, prove the worktree and base SHA at launch,
   and recheck the same enforcement during actual worker creation.
3. **Dispatch atomicity: BLOCKED.** Bind one host permit to one native task,
   the actual spawn/prompt side effect and a durable replay-safe receipt.
   Remove or specifically authorize the staged-task SQLite dispatch fence only
   through a reviewed main-process path.
4. **Independent review: PENDING.** Have a different engineer inspect the
   trust-boundary assumptions and execute an adversarial checklist before
   enabling execution. Passing CI is not proof of adversarial resistance.

## Desktop validation

The CI workflow `project-hub-clean-integration-ci.yml` includes:

- Native integration lint, focused tests and full typecheck on Ubuntu and Windows.
- `project-hub-native-smoke.spec.ts`: Electron profile isolation, backlog
  persistence, plan creation and disabled launch button using DOM interaction.
- `project-hub-pointer-smoke.spec.ts`: actual Playwright mouse event dispatch
  to the Electron sidebar, backlog and delegation controls, using only a
  disposable profile/repository. It is **automated pointer verification**, not
  a human-operated manual test.
- On failure, upload bounded Playwright failure artifacts for inspection.

**Human-operated desktop smoke remains separate:** on an isolated test profile,
open Project Hub with the mouse; add a story; navigate away/back; prepare a
delegation; confirm the launch action is disabled; close/reopen Electron and
check persistence; inspect that no agent process, worktree or token-consuming
session was started by Project Hub. Repeat on Windows and Ubuntu if those are
the supported targets. Do not enable a CLI agent for the manual exercise.

## GitHub review criterion

The PR may be considered **CI-verified for planning-only use** only if all
four matrix jobs pass at the same head SHA. This does **not** make the live
agent-launch architecture release-ready. Do not merge to `main` merely because
all CI checks are green; require a separate review decision for scope,
desktop behavior and trust boundaries.
