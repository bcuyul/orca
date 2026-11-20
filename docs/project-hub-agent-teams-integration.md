# Project Hub × Agent Teams: first integration slice

Reference: https://github.com/cobusgreyling/claude-agent-teams

This slice adds a **pure, read-only draft admission contract** and a human-reviewable team recipe. It does not install Claude Code settings, invoke Claude, modify terminal panes, send messages, reserve Dispatch, create native Run/Task records, or consume model tokens.

## Why not copy Claude's settings.json?

The reference repository is documentation, example prompts, hook templates and launcher scripts for **Claude Code's experimental Agent Teams**. It is not a portable agent execution engine. Orca already implements its own native terminal/worktree/session lifecycle, a tmux compatibility shim, and Project Hub authorization/Dispatch gates. We must compose those rather than create an unauthorized second runtime.

## Incremental rollout

1. **This PR**: validate team message drafts with exact project/run/task/generation, known roster, same worktree and bounded body. Any successful result is advisory only, and explicitly says delivery is not verified, replay is not safe and no execution is authorized.
2. **Next**: host-owned append-only inbox/outbox and stable message IDs, durable dedupe, observed delivery acknowledgments, bounded queues and cancellation fencing. Never automatically resend a reserved or ambiguous message.
3. **Then**: renderer team/roster/task board driven only by host-verified snapshots. Keep approval gates for plan, worktree ownership, provider authentication, quotas and real OS sandbox.
4. **Finally**: opt-in provider adapters (Claude Agent Teams native vs Orca-supervised multiple CLI sessions). No implicit equivalence between Claude's task-file protocol and Orca native Run/Task/Dispatch.

## Non-negotiable security gates

- A message to another agent is untrusted task data, not a permission grant.
- No arbitrary shell execution, automatic launch, push, merge or deploy from a message.
- Do not cross projects, runs, tasks, generations or worktrees.
- Do not infer a successful delivery from an accepted draft.
- Team members must not concurrently write the same files. Ownership and merging remain host-controlled.
- Provider-specific authentication, tool permissions, budget, model usage and hook provenance must be attested at the host boundary.
- No CI or Electron smoke has been run by this GitHub-only change.

## Proposed validation

```powershell
pnpm test src/shared/project-hub-agent-teams-contract.test.ts
pnpm tc
pnpm check:changed --maxWorkers=2
```

Only claim readiness after native Vitest, typecheck and Windows Electron smoke, followed by security review. Keep PR as **draft** until gates pass.
