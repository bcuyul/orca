# PR #9 — Native plan materialization, NO agent dispatch

A host-private bridge resolves the approved plan from Project Hub, verifies the
expected document revision, pinned plan SHA, exact task set and scope grant.
It reserves the control-plane operation before the first write, then creates an
actual Orca Run and Task rows using OrchestrationDb createRun/createTask.

Task dependencies are mapped from stable plan IDs to native task IDs using
topological order. The service checkpoints the Run/task mapping after each
irreversible write. Interrupted/unknown creation cannot automatically replay.

**NOT INCLUDED**: Coordinator.start, coordinator_runs linkage, Dispatch,
agent calls, CLI prompts, user-authenticated RPC, true launch authorization,
autonomous repairs, deployment, CI evidence of project functionality.

The current Coordinator loop uses a distinct coordinator_runs table and global
task iteration; connecting these Run/Task rows to the live Coordinator requires
a separate lifecycle/ownership-safe refactor. Do not claim this bridge executes
the DAG. Source plan text remains untrusted until an independent host launch
authorization enforces permissions and policy.

The integration tests use real in-memory Orca SQLite, validate native rows and
dependencies, replay, unknown failure and **zero** Dispatch creation.
