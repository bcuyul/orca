# Adaptive Decision Core — PR-AD-01 (Draft #7)

> Status: pure advisory TypeScript implementation. No CLI calls, no task creation, no scheduler, no model inference, no authorization from scores.
> Base: `docs/adaptive-delivery-feasibility` (Draft PR #6), stacked on Project Hub Intelligence PR #5.

## Goal

Make the smallest viable incremental runtime-facing *contract* for work classification and explainable priority ordering, using the research and offline experiment from PR #6. A typo fix must not require a full project plan, and a one-line authentication change must not be considered low risk merely because it is small.

## Design and trust boundaries

- `intent-analyzer.ts`: deliberately conservative bilingual lexical baseline, not semantic intelligence. Produces `workKind`, risk, ambiguity, recommended planning/gate and hardcoded `executionAuthorized: false`. Any genuinely ambiguous or high-risk request needs review; a future Atlas connector may provide a proposal but **not an authority decision**.
- `decision-contracts.ts`: bounded DAG of 1–20 typed tasks, role, state, admission snapshot, human review evidence, explicit criteria and effort. Validates nonfinite scores, IDs, unknown edges, cycles, duplicate IDs. A `granted` field in untrusted JSON does **not** grant permission in Orca: only the future host-owned authorization ledger can certify a trusted snapshot.
- `priority-score.ts`: user-provided swing judgments normalized to weights. Additive score (0–100), separate score/effort ratio. This is **MCDA** and an effort-normalized heuristic, not calibrated monetary cost-of-delay and not an empirically estimated probability of success.
- `priority-policy.ts`: ranks only tasks in `todo` with completed prerequisites, advisory granted snapshot and mandatory human review where high/critical. Excludes active/blocked/denied/pending. `mandatory` impacts priority only after eligibility, never grants access. FIFO, value, value/effort are deliberately distinct baselines. No worktree writes or dispatches.

### Important limitations

1. Regex-based intent classification is a **baseline only**; missing an unrecognized security phrase is possible. No use of the classifier as a safety/security authority. Source text is untrusted data, never a grant.
2. The unlock score is supplied by the planning process; a later iteration must derive/validate it from DAG transitive closure to avoid double counting and gaming.
3. No global budget solver, full optimization, stochastic prediction, EVSI policy or smart agent assignment. The exact enumeration remains in offline `tools/adaptive-delivery-lab` only.
4. A completed task is an input fact for advisory planning, **not QA verification**. The future host must ground it in a real Run/Task/Dispatch receipt and evidence SHA.
5. Current tie break uses stable lexical IDs; weights and criteria require actual human elicitations before production decisions.

## Verification

Run from repository root:

```bash
pnpm exec vitest run --config config/vitest.config.ts src/shared/adaptive-delivery/adaptive-delivery.test.ts
pnpm exec oxlint src/shared/adaptive-delivery
pnpm typecheck
```

New fork-scoped workflow `.github/workflows/adaptive-decision-core-ci.yml` runs Vitest, lint and typecheck on the Draft PR for Linux and Windows with the repository's existing dependency setup. A successful test does not grant production authorization.

## Next increments

- AD-03 / EV-05: host-side budget and scope authorization, separate from these advisory records; use real Orca IDs and CAS/replay safety.
- EV-04: Atlas connected planning proposals, with bounded schemas and human approval before any launch.
- AD-04: compare on actual admissible DAGs and budgets, with solver outside the UI thread.
- AD-06 / EV-07: evidence and independent QA by SHA; no developer self-attestation.
- AD-08/09: adaptive milestones, human gate and continuation in a *new* native Run when authorized.
- AD-10/13: calibrated models and Kev only with benchmark evidence, never as a privilege authority.
