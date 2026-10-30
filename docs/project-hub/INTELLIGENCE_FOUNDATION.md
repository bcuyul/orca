# Project Hub Intelligence — contracts-first implementation

## Real scope (PR #5, based on #4)

A small domain layer was added **inside existing Project Hub persistence**:
- **Memory candidates**: lesson, applicability, evidence link; only explicit human-approved candidates can be supplied as project memories to Atlas. No unattended self-training.
- **Shared lessons across projects**: a versioned, non-sensitive repository-level skills catalog (`project-hub-shared-skills.ts`), retrieved by bounded keyword matching. Its first entry documents the tested Windows SQLite EBUSY cleanup. No automatic private cross-project data sharing.
- **Atlas planning**: bounded JSON proposals (1–20 tasks, roles, acceptance criteria, dependency DAG). Unknown dependencies, cycles, duplicates and malformed values are rejected before persistence.
- **Replanning**: an immutable blocker associated to a plan/task; the next proposed plan must cite both the previous plan and its blocker. The old plan remains intact. It does not cancel a running worker or retry an uncertain operation.
- **QA reviews**: append-only reports with task/plan identity, verdict and evidence. The current screen records **human attestations** only. A copied QA prompt is not an executed reviewer.
- **Human decisions**: immutable accept/reject records for memory or plan proposals, with justification. Approval does NOT create native tasks, CI status, deployment or merge.

### Trust boundaries

`ProjectHubStore` already uses project-scoped JSON, secure persistence and revision checks. `isHubIntelligence` bounds the new optional `intelligence` payload; `isHubIntelligenceTransition` prohibits rewriting/deleting any prior plan, blocker, memory, review or decision. Legacy `schema:1` docs with no intelligence field (including PH-001) remain valid.

Atlas and QA prompts include SOUL text as role guidance, never extra permissions. Project context may be sensitive: review generated prompts before sending them to any model. Imported project/agent text is JSON-quoted and angle-bracket escaped in prompts so it cannot forge `<project-data>` boundaries or emit raw multiline instructions. This is only delimiter hardening; it does **not** eliminate LLM prompt-injection risk.

### What has NOT been implemented

- Atlas is not automatically invoked; the user currently copies its prompt and imports bounded JSON. These controls are an **honest, usable intake**, not fake autonomous execution.
- No bridge to Orca `RunCreate`/`WorkerStart` or coordinator identity/terminal ownership yet.
- No worker-diff collection or externally verified CI evidence in QA UI; review verdicts are manual declarations.
- No autonomous retry/correction loop, no safe release of unknown PH-001, no cross-project promotion of untrusted private lessons, no automatic PR/merge/deploy.

## Guided UX and resource boundaries (Draft PR #5)

- Plans and task dropdowns now display objectives, role and task labels, not only opaque IDs; IDs remain authoritative in stored records.
- Each plan/memory card has its own justification and explicit human confirmation; existing decisions are shown as accepted/rejected with the recorded reason. No old decision is overwritten.
- QA follows plan → task → evidence reference → optional external prompt → manual verdict/findings. Evidence is a **declaration**, not an automated GitHub/CI verification.
- This is a UI-only safety improvement: no native Run/Task/Dispatch, scheduled agent, reviewer launch, or push/merge/deploy path was added.

### Graphs and token efficiency

- A validated DAG already models dependencies among 1–20 tasks; do not add a graph database or heavy graph visualization dependency for this scale.
- Project memories and reviewed repository skills are already bounded. Retain approved-only project memory and targeted keyword retrieval until retrieval quality warrants more complexity.
- Future agent execution should pass a minimal task context (objective, acceptance, dependencies, targeted code/diff and relevant lessons), not a full project history on every hop.
- Separate model-facing token budgets from UI and persistence costs; **this PR does not currently invoke Atlas or QA models** and therefore cannot report real agent token savings.
- Prefer one planner, parallel execution only for independent DAG nodes, and a separate reviewer supplied with diff and verified CI references. Record actual per-run input/output token usage before tuning budgets.

## Next increments in dependency order

1. **Atlas connector**: call Orca's already-supported CLI/agent surfaces with a new, approved operation and durable plan identity, validate JSON output, persist proposal. Do not reuse PH-001 or fabricate session IDs.
2. **Native orchestration bridge**: choose/verify coordinator terminal, project/repo/host/base SHA; create Run/Task records via Orca's RPC authorization contracts, with CAS and replay-safety. Plan acceptance becomes a request for separate execution authorization, not a hidden dispatch.
3. **Blocker signal bridge**: map typed Orca worker errors/escalations into proposed blocker records, not direct mutations of running tasks. Atlas emits a revised DAG; human review gates rerouting and retries.
4. **Independent QA job**: establish read-only diff snapshot+commit identity+CI run ID, start a different reviewer CLI with a new context, parse a bounded report, attach verified evidence; do not accept an agent's self-attestation as CI.
5. **Reviewed skill promotion**: export a human-approved, redacted lesson into the versioned shared catalog via a reviewed PR; never auto-share private project documents.
6. **Integration gate/CD**: wait for required checks, QA, a real human merge authorization; any staging/deployment must have a separate protected environment and rollback.

## Tests and CI

Run `pnpm typecheck`, Oxlint, `src/shared/project-hub-intelligence.test.ts`,
`src/main/project-hub/project-hub-store.test.ts`, and existing replay-safe launch tests.
The draft branch's fork-specific workflow runs Linux+Windows. Do not claim success until the GitHub run finishes.
Do not merge this stacked PR until #4 and the original experimental #1 ancestry are resolved.
