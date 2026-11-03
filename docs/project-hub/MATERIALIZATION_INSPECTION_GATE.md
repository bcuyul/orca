# Project Hub — host-only materialization inspection (stacked PR)

This slice adds **read-only inspection** of existing host-admission receipts. It is
stacked on PR #16; it introduces no renderer or agent RPC, no new permission
grant, and no worker execution.

## Why this matters

Native Run/Task materialization uses durable checkpoints. If a process dies
between creating a task and recording the next checkpoint, the database may
contain additional work not reflected in the receipt. The existing ledger
intentionally preserves `reserved` / `unknown` rows and their consumed budget.

The inspector checks the original request hash, scope, persisted receipt
shape, native Run and Task rows, unrecorded tasks and Dispatch evidence.
It **never writes**, **never grants** and always returns
`safeToRetry: false`. An `unknown` operation always requires human
reconciliation even when its checkpoint matches observed native rows.

Completed receipts now use the same verification on an idempotent replay:
a duplicate task map, missing Run/Task, unexpected extra Task or existing
Dispatch makes the replay refuse to succeed. Reconciliation is not
automated by this PR.

## Boundaries and acceptance

- Private module: `native-materialization-inspection.ts`.
- Existing materializer reuses the inspector for **completed receipt replay only**.
- Unit regressions: absent, reserved, unknown after interrupted write,
  request mismatch, corrupted JSON, duplicate IDs, unexpected native row,
  and zero implicit Dispatch/coordinator launch.
- The existing Windows/Ubuntu 4-job CI matrix remains mandatory.
- No host authentication RPC, CLI spawn, Coordinator start or grants.
- Existing PH-001 must not be rewritten or retried.

**Next slice:** a separately reviewed authenticated host-only approval and
manual reconciliation flow; OS sandbox and worker launch remain later gates.
