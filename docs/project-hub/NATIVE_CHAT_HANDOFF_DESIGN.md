# Project Hub → native Orca orchestration: automatic chat handoffs

Status: **design only / no execution permission**. This is the next contract to implement, not an enabled execution feature.

## Product goal and laboratory evidence

A user states a goal and, after approving the plan and the host's separately scoped execution permissions, Orca should coordinate **Atlas → Forge/Flow/Data → independent QA** through its **existing native chat/session and orchestration transport**. Users must not select the same plan/task repeatedly, copy prompts, switch chats manually, paste responses, or type Git SHA values for normal work.

The real `repo-laboratorio` exercise demonstrated a manually transferred approved DAG (Forge documentation task, QA dependent task), an OpenCode-produced README commit `73846d461d63e11c94ba93c7a9efa45deaf7e6e4`, a separately run Claude Code QA review, and an append-only human-attested approval. This is **not** evidence of automatic CLI execution or authenticated QA.

A second review has identified real defects in the first approved README: `darpor`, `pruebasy`, `ningúnremoto`, `QAconfirma`, and a README-specific diff command that cannot prove no other files changed. The next laboratory cycle must record `changes-requested` on the *same report*, retain the earlier `approved` review, produce Forge v2 with an explicit predecessor ID, and demand independent QA v2. Do not invent a new report, review, or completion state.

## Reuse the existing native transport — do not reinvent clipboard automation

Relevant existing modules:

- `src/main/runtime/orchestration/send-agent-turn.ts`: send to **structured sessions** (host send + settlement, caller key, runtime fence, idempotent operation ID, queued/now) and **terminal sessions** (runtime prompt write, operation ID, preflight guard).
- `src/main/runtime/orchestration/coordinator-task-dispatch.ts`: native dispatch contexts, authenticated target ownership, safe preamble delivery, refusal on stale worktree and `dispatched-unobserved` handling.
- `src/main/runtime/orchestration/coordinator.ts`: ready-task selection, dependency-aware dispatch, concurrency slots, terminal provisioning. It currently expects pre-created tasks; it is *not* the Atlas planning engine.
- `src/main/runtime/orchestration/structured-session-mail-target.ts`: addresses session-bound mailboxes for native chat delivery and restart recovery.
- `src/main/runtime/adaptive-delivery/native-plan-materializer.ts`, `native-materialization-inspection.ts`: read-only inspection and host-only lab materialization with refusal to blindly retry uncertain writes.
- `src/shared/project-hub-handoff-readiness.ts`: bounded read-only projection for human-attested evidence; it does **not** authorize a native Dispatch.

Use the **same transport** for both live-session message sends and native worker dispatches. Do not simulate UI typing or clipboard paste; do not depend on the currently focused tab, chat title, or terminal pane. Session binding must come from an authenticated host-owned ID and current runtime incarnation, not from user-controlled Project Hub JSON or reported agent text.

## Proposed automatic state machine

1. **Goal & plan:** collect story/context once. Atlas reads the real repository and proposes a bounded, versioned DAG including role, task ID, dependencies, acceptance, base SHA and sandbox needs. Validate limits, cycles and scope.
2. **Plan approval:** human approves plan hash/revision. This grants **no native mutation or execution**.
3. **Scoped host admission:** host authenticates project/repo/worktree/actor, computes the plan hash, displays proposed effects, binds a one-use, time-bounded capability. Materializing Runs/Tasks is a different approval from starting agent processes. Deny by default.
4. **Materialize:** create native Run/Tasks with durable receipt, causal provenance and crash-safe reconciliation. A `reserved/unknown` outcome remains blocked until manually reconciled. Never retry irreversible operations because of a timeout.
5. **Native routing:** select the next eligible task (topological order and human decisions), assign the configured CLI/provider and existing/new **sandboxed** session. Stage a unique `operationId` and runtime fence before sending through `sendAgentTurn`. A queued/pending/unobserved send **must not** become a second prompt on retry. No worker is launched without independently proven OS enforcement.
6. **Forge delivery receipt:** correlate actual worker session/dispatch to task, collect committed head/base SHA, changed-file list, diff and real tests. Verify repository, artifact and process provenance; do not silently promote human-attested `external-unverified` records to authenticated execution.
7. **Independent QA:** resolve a fresh/separate authorized QA session from the host. Send the *original* acceptance criteria, immutable base/head SHAs, read-only diff and observed test evidence, not merely Forge's summary. Require independently verified reviewer identity and a bounded result tied to **one implementation ID**.
8. **Reject/replan:** `changes-requested` records a blocker and explicit findings. Atlas proposes a correction task or bounded replan; Forge receives the findings and base from the host under a **new** authorization as required. A new head SHA invalidates prior QA for readiness, without deleting earlier events.
9. **Final human gate:** present actual evidence to user for review; no implicit merge, push, deploy, production access or grants from a successful QA verdict.

Task and delivery transitions must be recoverable and append-only. The *same* work item must remain correlated across Project Hub's durable document, native Run/Task, Dispatch, session, commit and QA report.

## UX contract

- A single **Run approved plan** action should summarize permissions and effects **only once**, with explicit separate host materialization/execution approvals where necessary.
- Automatically select plan/task/role/provider/sandbox and target chat, using native orchestration; display the decision and allow override before launch.
- Forward the actual agent prompt **between chats**, including queued inputs to busy agents. Capture and correlate reply streams, completion and failures without manual paste.
- The Project Hub panel shows active Run, task DAG, session links, current commit, evidence, queued/unknown/rejected states, provenance, and per-task budgets.
- Manual copy-only handoff remains available as a safe fallback and does not claim execution.
- A task in `qa` role represents a real scheduler task only once native execution is enabled; a manually linked review on the Forge task must not be mislabeled as that QA task having executed.
- Legacy QA notes should be visually separated from implementation-linked QA; no duplicate review entry required.

## Security gates (mandatory before turning this on)

- Host-authenticated user consent and scoped one-use grants, separate for materialization vs execution; withstand replay, cross-project, wrong SHA, stale window and forged renderer messages.
- **Real OS isolation at the spawn boundary**, Windows and Linux: permitted workspace RW, external trees RO/denied, network egress controls, distinct credentials, process ownership, cleanup and negative tests.
- No auto-grants from SOUL.md, terminal prompt, model output, user-provided project JSON, or Project Hub's `approved` UI state.
- Existing terminal/session binding proof, caller generation fence, operation idempotency, durable uncertain-send ledger, and no blind resend.
- Independent QA must not share the implementer's session or privileged mutable workspace; verify diff and checks from host source at exact SHA.
- Human gates for merges, pushes, deploys, secret accesses and security-sensitive changes.

## Performance and resource optimization

- Reuse existing sessions only when same project/scope/host, valid generation and idle/writable; otherwise provision a safe isolated session.
- No busy polling on every renderer keystroke. Subscribe to host Run/Task/message events and coalesce invalidations.
- Use existing coordinator concurrency limits plus wall-clock/token budgets, queue backpressure, active-session caps and provider throttling. Limit agent spawning bursts.
- Index Run/Task/Dispatch by project+plan+task; avoid per-task N+1 SQLite queries and repeated Git diffs. Cache evidence by immutable SHA pair; invalidate on new commit.
- Batch bounded progress updates to renderer; keep only selected-plan cards mounted; preserve pagination and size caps for reports and logs.
- Compare CPU/memory, first-dispatch latency, message settlement, duplicate send rate and restart recovery in controlled Windows/Ubuntu tests. Performance claims require measurements.

## Sequenced implementation slices / acceptance

- [ ] **Slice A: read-only routing preview.** Given an approved DAG and existing authenticated sessions, show deterministic task→provider→session routing and exact pending message body. No sends/grants. Tests: task ordering, different project, unsupported providers, missing QA session, stale SHA.
- [ ] **Slice B: host materialize-only grant.** Main-process consent, one-use capability, crash recovery and explicit manual reconciliation. Negative IPC tests, Windows+Ubuntu.
- [ ] **Slice C: dispatch-to-existing sandboxed sessions.** Reuse native send primitives with operation ID, binding fence and durable outcome; queue and resend safety; sandbox denial tests. No process spawn without platform enforcement.
- [ ] **Slice D: worker evidence and independent QA.** Verified Git receipts, tests, independent session routing, retry/replan under a new task decision; adversarial cross-chat tests.
- [ ] **Slice E: UI automation and optimization.** Remove manual plan/task/SHA entry from happy path; preserve copy-only fallback; instrument resource limits and recoveries.

**Merge each slice only after independent review, unit/Electron end-to-end tests and Windows/Ubuntu CI. Do not turn on agent execution via feature flag alone.**
