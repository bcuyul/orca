# PR #12 — Host-private execution permit, no agent launch

**Base:** Draft PR #11. This is a deliberately separate launch-admission
control plane and a synthetic test gate, not a public or live execution feature.

## What this implements

- Pins the original materialized Native Run / Task mapping to
  project, repository, host, base SHA and plan SHA in the completed receipt.
- Requires a **separate verified host execution decision**, not merely a
  Project Hub `plan.accepted` event.
- Rechecks that the selected worktree is currently the approved repository
  and base SHA, using host-provided read-only identity evidence.
- Reserves a single `agent_turn` operation via the host budget ledger;
  persists one immutable prepared permit per native Task and request ID.
- A failed/interrupted permit reservation stays reserved or unknown; no
  automatic second attempt. Completed replays return the same receipt.
- The existing **SQLite dispatch quarantine remains active**, even with
  a prepared permit. This PR never starts a terminal, worker or model.

## Security boundary

`VerifiedHostDecisionReader` and `VerifiedWorktreeReader` are abstract
interfaces for trusted *main process* implementations. The interface does
**not** authenticate anyone by itself. This feature is host-private and must
not be wired to IPC/RPC until the actual authenticated user decision source,
worktree ownership proof and transactional dispatch authority are implemented.
In tests, these readers are deliberately simulated.

Do not treat an `agent_turn` admission count as token or monetary usage.

## Follow-up before live CLI tests

- Authenticated local human execution decision path and auditable revocation.
- Durable Run-specific execution session and task authority, including
  per-turn budget consumption at the actual Dispatch boundary.
- Worktree ownership, explicit no-push/merge/deploy policy and verified SHA.
- Refactor allowlisted dispatch so permit consumption and Dispatch creation
  occur atomically; restart/stalled prompt replay remains fail-closed.

## CI

Target: Windows and Ubuntu (Oxlint, Vitest real SQLite + TypeScript).
