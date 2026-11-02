# PR #8 — Host admission, scope and operation budget

This is a private main-process API and does not expose a renderer/RPC entrypoint or start any agent.

- A host-originated approval records the project/repo/host, pinned base SHA and plan SHA, allowed task ids, expiry and operation ceiling.
- A single BEGIN IMMEDIATE transaction checks all restrictions and reserves the operation before any side effect.
- Same request ID + same payload returns the saved state; mismatched payload is rejected.
- Unknown reservations continue consuming capacity; no blind retries or automatic refunds.
- Host approvals are currently **test fixtures/internal calls only**: recordHostApproval is NOT an authenticated user-approval endpoint. The host identity and human consent boundary must be built before exposing this service.
- The budget is count of admitted operations, not measured USD/tokens or a provider quota.
- The service creates additive SQLite tables when constructed, without changing existing orchestration schemas.
- No operation is connected to a CLI, Run, Coordinator or Dispatch. No writes to main, deployments or push.

The following bridge PR will exercise materialize_run only in a deliberately no-dispatch integration harness. Host-attested source and crash/unknown reconciliation remain hard requirements before live autonomy.
