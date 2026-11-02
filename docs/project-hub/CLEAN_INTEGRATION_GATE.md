# Clean Project Hub + Adaptive Delivery integration gate

## Why this branch exists

This is a **review-only integration snapshot**, assembled onto the current
`main` tree with Git blob identities preserved for the native Project Hub and
Adaptive Delivery work from Draft PRs #2–#14 (source tree includes merged #14).

**Explicitly excluded:** all six files under `extensions/project-hub/`
introduced by experimental PR #1. That HTML plugin is NOT HOST-COMPATIBLE
and must not be bundled into a release or imported into native code.

## Authority and known gaps

- Main stays unchanged while this PR is Draft.
- Features behind Project Hub and Adaptive Delivery may be incomplete; CI passing
  does NOT prove Electron desktop UI, real CLI, OS sandbox or authenticated
  execution approval.
- Project Hub plans, AI-generated skills and worktree paths are not launch
  authority. Staged Adaptive tasks must remain blocked from Dispatch until
  durable host permission and sandbox enforcement are proven.
- The snapshot preserves source **content**, not the individual stacked commit
  history. Original commits and detailed review context remain in PRs #1–#14.
- Do not interpret a ready-to-merge GitHub state as product readiness.

## Required acceptance before merging into main

1. Diff reviewed: **zero `extensions/project-hub/` paths**, no unreviewed
   migrations, executable hooks or secrets.
2. CI on both Windows and Linux: typecheck, lint and relevant Project Hub,
   Adaptive Delivery and Coordinator suites, including native SQLite.
3. Independent review of delegated CLI launches, prompt injection handling,
   worktree isolation (NOT an OS sandbox), and host-only access controls.
4. Electron desktop smoke test with an isolated temporary user-data directory.
5. Verify staged work cannot spawn real agents; compare source and packaged
   skill discovery on Windows, Linux, macOS as applicable.
6. User approval before enabling real agent execution, publishing an app build
   or merging this large experimental integration into main.

This PR does not itself activate or launch any agent and is safe to inspect
without merging into main.

## Actual integration status (November 2, 2026)

- PR #1 is closed **without merge**, retained for historical traceability.
- PRs #2–#12 remain Draft stacked PRs, NOT separate candidates to merge into `main`.
- PRs #13 and #14 merged only into their stacked base branches.
- PR #15 remains a Draft integration snapshot; no publication or merge authorized by CI alone.
- The Project Hub renderer's live `agent.launchReplay` call was removed. It can still
  persist delegation plans, but **cannot initiate CLI execution through its UI**.
- The host RPC rejects the `project-hub` launch label for defense in depth, but the
  label is caller-controlled and **must not** be treated as an authenticated sandbox
  or a general security boundary.
- An isolated Playwright Electron smoke spec now covers panel boot, backlog persistence,
  and the disabled launch UI on disposable profiles. A test file and workflow declaration
  do **not** establish a PASS until GitHub Actions runs succeed on both systems.
- The verification still needs independent host authorization, real OS sandbox
  enforcement, and a comprehensive security review before execution is enabled.

### Verification workflow

`Clean Project Hub Integration` runs native lint/tests/typecheck and an Electron
smoke matrix for Ubuntu and Windows. The E2E fixture generates disposable user
profiles and repositories; no real user account, model CLI, remote worker or
production environment is used.

The release gate is intentionally **fail closed**: while any Electron/security
verification is unconfirmed, preserve Draft status and do not merge to `main`.
