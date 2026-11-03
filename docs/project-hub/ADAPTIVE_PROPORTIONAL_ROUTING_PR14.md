# PR #14 — ODD-inspired proportional routing (advisory only)

Sources reviewed: [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai)
README, [Organic Implementation Trigger Rules](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/trigger-rules.md)
(MIT; Alan Buscaglia/Gentleman Programming). This PR adapts the philosophy,
not their source implementation or evaluation statistics.

## Problem

Our `analyzeIntent` labels microfix/use-case/module/project and risk, and MCDA
ranks ready backlog tasks. Neither yet answers separately:

1. Can a new session resume from the request + the diff alone?
2. Is a fresh agent justified by a **named, measurable reason**?
3. Should we write a recoverable feature record?

## New advisory policy

`routeAdaptiveWork(intent, evidence)` produces a repeatable suggestion with
four routes: direct_inline, delegated_direct, clarify_first, read_only.
Documentation is independent: diff_only vs recoverable_feature.

- Clear + resumable + no named reason => **inline** with focused tests.
- Cannot resume from diff or an external wait exists => feature record,
  but NOT automatically a subagent.
- Delegation only for extended exploration, two meaningful independent
  disjoint units, context backstop, or independent verification for high risk.
- Unclear scope => clarify first; read-only research stays read-only.
- The number of files, LOC, labels like "MVP", and arbitrary model cost
  estimates are intentionally NOT routing triggers.
- Keep risk/human checkpoint from `analyzeIntent`; never demote it.
- More autonomy still requires the separate host-authenticated budget,
  OS sandbox, explicit user approval and atomic Dispatch admission.
  `executionAuthorized` is ALWAYS `false` here.

The evidence structure is an **advisory statement**, not cryptographic
proof of understanding or resumability. UI/agent must report uncertainty
rather than forge true flags. No renderer/host dispatch wiring in this PR.

## Evidence and benchmarking limitations

Gentle-AI reports for one small bug: 335s/56 turns/$0.339 before,
77s/10 turns/$0.105 after. It calls its local experiment n=1 per
cell and API-equivalent costs. Therefore the differences are *observations*,
not a causal estimate or guaranteed Orca savings.

For an Orca evaluation, record matched tasks, same CLI/model, time,
turn count, token-equivalent cost if actually observable, QA pass rate
and human correction time; evaluate paired distributions and variance,
not one-run averages. Include high-risk negatives, long sessions and
cross-project leakage, with no unapproved live model launches.

## Skills interaction

`adaptive-backlog`: skip for inline microfix.
`adaptive-story`: refine only when ambiguity/feature value warrants it.
`adaptive-pair`: bounded red-green-refactor cycle, without treating a
worktree as a security sandbox.

## CI and permissions

- Windows + Ubuntu: `pnpm exec oxlint src/shared/adaptive-delivery`
- `pnpm exec vitest run --config config/vitest.config.ts src/shared/adaptive-delivery`
- `pnpm typecheck`
- No CLI, push, merge, deployment, new Task or Dispatcher enabled by code.
