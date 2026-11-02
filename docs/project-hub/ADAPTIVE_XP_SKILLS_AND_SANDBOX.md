# Adaptive Delivery — thin XP skills and real execution isolation

Source review: [HolaMundo video, 2026-10-23](https://www.youtube.com/watch?v=5JjuF1zpNbI),
and [nschurmann/hola-ai](https://github.com/nschurmann/hola-ai), MIT (Nicolas Schurmann, 2026).

The author's guidance is an opinionated workflow, not production-ready automation:
`/backlog -> /story -> /pair`. He explicitly presents those skills as experimental.
The Orca skills here are original **adaptations** of the method, not unmodified copies.
Keep attribution; upstream uses an MIT license.

## Philosophy for Orca

- Microtask: route straight to one bounded test/code/review step.
- Story: refine just before implementation; 2-3 acceptance tests, few choices.
- Module/project: a concise backlog of *vertical user-value slices*, with a
  walking skeleton and priority/dependencies. Do not demand a compulsory MVP.
- Separate regulatory, infrastructure and security constraints from user
  stories when they are genuine independent work.
- Work in RED -> GREEN -> small refactor steps. Preserve accepted test
  expectations and evidence; independent QA sees diff and original criteria.
- Change scope/critical design/permissions: human decision. Inside preapproved
  low-risk budget, Orca may proceed until the next checkpoint.
- Prefer small reviewable PRs and working demonstrations over large SDD
  paperwork, but retain durable risk, budget, authorization and decisions.

## Worktree is not sandbox (security boundary)

Git linked worktrees provide separate file checkouts and indexes. They
do not constrain a process's OS file permissions, environment variables,
network access, IPC, children or host sockets. The official VS Code agent
documentation explicitly distinguishes code isolation from OS sandboxing:
https://code.visualstudio.com/docs/agents/concepts/agent-harnesses
https://code.visualstudio.com/docs/agents/concepts/trust-and-safety

The execution-permit preflight now rejects missing, worktree-only or
incomplete sandbox evidence. It requires **trusted-host reported** OS-enforced
filesystem, network and child-process restrictions with a nonempty policy ID.
This protects against accidentally treating a worktree path as proof
of isolation; it is NOT proof that the sandbox exists or is correctly
configured. The agent cannot supply the evidence. No implementation here
actually creates a container or kernel sandbox.

**Before any live CLI dispatch:** verify the host sandbox itself (including
symlinks/junctions, mounted sockets, secrets, network egress and child
processes), revalidate at the atomic dispatch boundary, fail closed if
unavailable, and obtain a separate authenticated user execution decision.
Windows/Linux/macOS require platform-specific enforcement and tests.
No automatic unsafe host fallback; any future trusted-host mode needs its
own distinct explicit high-risk human decision and threat review.

## Skills in this PR

- `skills/adaptive-backlog/SKILL.md`
- `skills/adaptive-story/SKILL.md`
- `skills/adaptive-pair/SKILL.md`

They are instructions, not permission-granting runtime logic. They are
committed as skills in Orca's existing skill directory. Verify packaging
and the target agent's skill discovery before promising automatic loading.
The third-party upstream skills remain available separately under their MIT terms.

## Acceptance

- [ ] CI Windows and Ubuntu: lint, native SQLite integration tests and typecheck.
- [ ] Worktree-only (even correct SHA) cannot prepare agent execution permit.
- [ ] Missing/bogus sandbox attestation fails closed, valid trusted-host
      *test fixture* can prepare (but not Dispatch).
- [ ] Existing staged-plan dispatch SQL fence still blocks a worker.
- [ ] Skill wording does not authorize actions outside the native runtime.
