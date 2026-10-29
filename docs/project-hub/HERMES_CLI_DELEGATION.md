# Project Hub × Orca CLI orchestration — first vertical slice (draft)

## Motivation and source

Hermes Agent documents the `delegate_task` architecture as a parent orchestrator assigning focused work to fresh-context child agents; child completions are summarized back to the parent. It also documents parallel batches, bounded nesting, steering, stopping, and profile isolation. See:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/
- https://hermes-agent.nousresearch.com/docs/user-guide/profiles

**This PR does not embed Hermes or reimplement `delegate_task`.** It uses the already-existing Orca `agent.launchReplay` and managed-worktree implementation to launch **OpenCode / Codex / Claude Code / Hermes CLIs**, using the agent's installed local credentials and subscriptions. This is an adaptation of Hermes' model, not feature parity.

## Exact scope implemented

- In **Project Hub → Delegación**, a new **Central CLI** lets users select 1–10 eligible stories, choose a CLI implementer and a *different* proposed reviewer, select a concurrency ceiling (1–3), and save a plan.
- Every task has a durable, immutable `operationId`, bound to a **specific Orca Project.id, repoId, hostId, storyId and baseBranch** before any worktree is created.
- The user must tick a launch authorization and click **Lanzar**. Orca's own `agent.launchReplay` performs the creation of a **fresh Git worktree + terminal CLI + prompt**, with `surface:'terminal'` and `presentation:'background'`.
- The coordinator logic in this slice lives in the UI, launching at most the currently available slots. The CLI agents work in parallel once launched; the RPC launch requests are serialized to preserve an auditable record.
- **Fail closed**: first store a `launching` reservation via `projectHub.save`; then invoke the Orca runtime. Record a `launched` state only if the host reports both a terminal outcome and the initial prompt handed to its terminal. Anything ambiguous is stored as `unconfirmed`, is never retried automatically, and consumes capacity until reconciled. The original operation ID is never silently replaced.
- The main-process store rejects deleted/edited previous delegation rows or illegal transitions. Unit tests exercise plan IDs, duplicate prevention, host binding, receipts and store transitions.
- Local host only for this first slice. Remote `ssh:` and `runtime:` hosts are intentionally refused because routing through `window.api.runtime.call` alone would not prove the correct host.

## State progression

```text
Backlog/Ready
    -> [prepare, SAVE] planned
    -> [human approve, SAVE] launching (same operationId, same repoId+hostId)
    -> [Orca agent.launchReplay] new worktree + CLI
    -> [verified host receipt, SAVE] launched
     or [unknown/error, SAVE] unconfirmed
```

`launched` means **terminal successfully created and prompt handed over**, NOT story completed or tests passed. An unconfirmed launch may already exist; do not press a retry button with a new operation ID.

## Important limitations — not production-ready

1. This is **not yet a persistent background scheduler**. If the UI closes, the launch and reservation may continue but its final receipt might remain unresolved. Recovery is a separate deliverable and must query Orca's owner/host records using the saved operation ID, not guess from branch names.
2. The proposed independent reviewer is **metadata**, not a second auto-started agent. The existing manual handoff UI remains available. Review completion cannot be marked automatically.
3. No automated `steer`/`stop`, nested coordinator roles, live transcripts, DAG dependencies, worker reports, summary synthesis, CI execution, GitHub PR creation or deployment.
4. **The Project Hub provider-identity fallback is still unresolved** for two forks sharing the same upstream. Per-execution `repoId + hostId` binding prevents dispatch in the wrong repository, but the parent document may still need a migration to a truly fork-specific project ID.
5. The available-capacity counter is **conservative**: `launched` and `unconfirmed` count as occupied until we integrate Orca's terminal/session status and an audited completion state. Two agents are a sensible starting budget; do not expand to 10 yet.
6. Worktree setup hooks are disabled for these launches. If a codebase requires setup, use Orca's existing setup workflow, rather than pretending workers have all dependencies.
7. The terminal launch may be refused if Orca's runtime does not advertise the supported `agent.launchReplay` capability. The result is visible as unconfirmed. No fallback to unsafe paste or direct shell injection.
8. No typecheck, lint or Electron e2e is claimed for this branch yet. The previous branch's verified Windows results do not automatically certify these changes.

## Human verification checklist

**Do not switch away from the existing Orca worktree with OpenCode's uncommitted tests.** Use a new checkout:

```powershell
cd "$HOME\Projects\Orca-ProjectHub"
git fetch origin
git worktree add "$HOME\Projects\Orca-ProjectHub-Hermes" origin/feat/project-hub-hermes-delegation
cd "$HOME\Projects\Orca-ProjectHub-Hermes"
git status --short
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:node src/shared/project-hub-delegation.test.ts src/shared/project-hub-types.test.ts src/main/project-hub/project-hub-store.test.ts
pnpm dev --worktree-profile
```

**Test in isolated project and do not launch multiple workers as the first test.** First prepare a *single* story and verify it remains `planned` after opening/closing Orca. Then explicitly approve and launch **one OpenCode CLI**. Verify Orca created exactly one new worktree, stored its terminal handle and its matching operation ID. Test deliberate failure with a missing CLI: it should show `unconfirmed`, never silently switch to another CLI or send a second prompt. After this, try two independent stories with a maximum of two.

Do **not** merge these PRs into `main` or upstream based on plan-only tests. Orion/Orca host support, cross-window crashes, remote hosting, security review and UI regressions remain required.

## Roadmap to Hermes-like parity

1. **Orca-owned execution bridge:** move launch+receipt persistence into a host-side saga with durable reconciliation and host capability negotiation.
2. **Live central:** map `storyId → runId/taskId → worktreeId → terminal handle → agent identity → evidence` using Orca orchestration DB, agent status and worktree metadata.
3. **Dependency DAG:** translate planning stories into `orchestration.taskCreate`, with bounded dispatch, heartbeats and independent reviewer workers.
4. **CLI controls:** pause, stop, steer and resume through Orca's authenticated terminal/session mechanisms, never by constructing shell commands in the renderer.
5. **CI verification:** capture git diff, lint, TS, tests, test coverage and base-ref freshness; treat missing CI as unknown (not passed). Prepare PR only after a review gate.
6. **Optional Hermes native mode:** if Hermes CLI itself supports `delegate_task`, let the Hermes process own its child conversations and report only its parent task to Orca. Do not clone Hermes subagent behavior or share credentials between profiles.
