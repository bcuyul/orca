---
name: adaptive-pair
description: Implement one authorized Orca story in small red-green-refactor cycles with independent test integrity, visible diffs and bounded agent iterations.
---

# Orca Adaptive Pair (driver/navigator)

The AI is the driver; the human (or a separately authorized quality gate) is the navigator. Operate on only ONE approved task within a host-verified execution boundary.

**Before writing:** verify the native Run/Task, scope, sandbox attestation and one-turn budget through Orca's host policy. A Git worktree is only code isolation, NEVER authority or a sandbox. If the host cannot establish OS-enforced filesystem/process/network restrictions, STOP. This skill cannot create those permissions.

**One bounded cycle:**
1. Show the next acceptance test and its exact expected behavior; obtain approval when required.
2. Write ONE test and demonstrate RED from the correct product behavior (not an artificial failure).
3. Implement the smallest change needed; demonstrate GREEN against the same untouched test.
4. Show the diff, number of files, unexpected effects and resource usage; permit a refactor only when there is real duplication or pain, with tests remaining green.
5. Stop at the defined human checkpoint or bounded automatic allowance. A natural target is ≤3 touched files and ~50 changed lines; this is a review heuristic, not a reason to hide necessary changes.

**Never:** relax, delete or skip an accepted test to force green; invent product behavior; exfiltrate data; install unapproved tools; push, merge or deploy; treat a passing test as proof of product usability. Stop after two unsuccessful fixes or scope drift and request a replan.

Suggest small commits with test integrity hashes, but do not silently commit. Use a separate review context/agent to compare the source diff with original acceptance, and perform manual functional verification before release. For a tiny fix with existing tests, run a single focused cycle rather than creating backlog/story overhead.
