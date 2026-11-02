# PR #11 — Scoped Coordinator and mocked one-task execution

**Stacked on Draft PR #10. No authenticated Adaptive execution endpoint is introduced.**

## Purpose

The legacy Coordinator enumerates global tasks and messages. This increment
adds opt-in `taskRunId` as a **native Run scope**, distinct from coordinator_runs.id,
so a controlled fake worker test cannot take another project's tasks.
Legacy orchestration without this option is unchanged.

## Implementation

- Check native Run exists before processing.
- Select tasks within the native Run for preflight, ready work, final
  completion and DAG convergence.
- Only consume messages whose run_id matches the selected Run.
- Reblock human gates only within the scoped Run.
- Retain the PR #10 staged-plan quarantine regardless of taskRunId.
- Keep global active-worker accounting conservative.

## Test cases

1. Unknown native Run rejected.
2. Empty scoped Run does not steal a ready Task from a different Run.
3. One normal Task completes with a fake CoordinatorRuntime and lifecycle message;
   foreign Task and foreign message remain untouched.
4. Tagged Adaptive plan remains non-executable even when its Run is selected.
5. Prior Coordinator regression suite remains green.

## Safety limitations / next gate

The opt-in Run scope is a **filter, not authenticated authorization**.
The fake terminal does not call a model or edit the filesystem.
No renderer/RPC execution endpoint, no dispatch of Adaptive staged Tasks,
no human consent projection, and no USD/token tracking.

Before live CLI tests: durable, host-authenticated execution admission per
native Run + worktree + Tasks + snapshot, atomic dispatch reservation and
crash recovery, and a mechanism to authorize only the exact chosen Task(s).
Do not treat Project Hub acceptance as execution consent.
