# PR #10 — Staged plan execution quarantine

**Stack:** Draft PR #9, no dispatch or CLI automation authorized.

## Discovered hazard

The NativePlanMaterializer creates `ready` Tasks with a tagged untrusted plan
spec. The preexisting Coordinator enumerates Tasks across all Runs and might
otherwise enqueue those tasks without an authenticated Adaptive execution grant.

## Defense in depth

- HostAdmissionLedger installs persistent SQLite triggers rejecting Dispatch
  creation and retargeting for the exact staged provenance marker, even through
  direct SQL and after process restart. The marker grants no authority.
- Coordinator excludes staged-only Tasks from decomposition, ready queue,
  final status and DAG convergence. It must not create a terminal to run them.
- Ordinary Orca Tasks continue to behave normally.

## Required next gate

An authenticated host execution grant bound to Run/Task/host/worktree/plan SHA,
a Run-scoped Coordinator, and verified budgets are required before ever
lifting the deny-only barrier. No agent launch, remote worker, QA or deploy
is implemented here. The existing unscoped Coordinator is not a safe launch
mechanism for Adaptive plans. Do not mark these tasks executed.
