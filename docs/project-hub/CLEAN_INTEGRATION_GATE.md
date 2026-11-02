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
