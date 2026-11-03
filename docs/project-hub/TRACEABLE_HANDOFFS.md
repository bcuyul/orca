# Project Hub — Atlas plan → external Forge handoff → QA review (Draft)

## Purpose

A human-approved Atlas DAG can now acquire **append-only external work
evidence**, including the implementer's label, baseline SHA, head SHA, test
summary and artifact reference. A QA review can point to the exact report.
This is groundwork for genuine orchestration, **not proof of CLI execution**.

## Boundaries

- The new evidence source is always `external-unverified`. No machine attestation,
  GitHub check lookup or authenticated reviewer identity is implied.
- Reports require an explicitly accepted plan and can attach only to Forge,
  Flow or Data tasks.
- A later report on the same task must reference the immediately preceding
  report ID. A prior QA verdict does not approve later source changes.
- A linked QA declaration must point to the exact plan/task/report and its
  stated reviewer label cannot equal the implementer label. Distinct text
  labels are **not** cryptographic identity verification.
- Old schema-1 Project Hub documents without `implementations` remain
  readable, and legacy QA notes remain valid. Legacy QA notes do not count
  as linked reviews for readiness.
- Every record is immutable after saving: ProjectHubStore CAS and
  isHubIntelligenceTransition enforce append-only prefixes.
- The readiness projection uses Map/Set indexes for O(N) data processing,
  returns `executable:false`, and never creates a Run or Dispatch.
- Forge prompts are *copy only*. A user must separately authorize any
  external CLI action and verify the resulting commit and tests.
- Host approval, durable materialization, Coordinator, OS sandbox, secrets,
  launches, self-approving agents and deployments are still **out of scope**.

## Validation and next slice

Run the Windows/Ubuntu native matrix (Oxlint, Vitest, typecheck,
isolated Electron Playwright). Then add a focused Project Hub UI showing
the evidence ledger, report-linked QA, and per-task readiness summaries.

The eventual CLI execution milestone requires **separately implemented**
host-owned authenticated approval, task-specific scoped capabilities, real
OS sandbox at the spawn boundary, bounded resource budgets, crash-safe
reconciliation and independently verified QA.

Never change the unknown historical PH-001 launch record automatically.
