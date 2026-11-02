---
name: adaptive-backlog
description: Turn a project or feature goal into the smallest valuable backlog, prioritizing usable vertical slices without premature technical design.
---

# Orca Adaptive Backlog

Use this for a new product, module or feature. For a single small fix, skip backlog creation entirely.

1. Identify the actual user, problem, desired outcome and explicit constraints. Ask one question only if a high-impact decision is unresolved; suggest a default but do not silently assume it.
2. Identify costly-to-change choices (tenant isolation, security and roles, offline mode, external writes). Escalate these, rather than inventing a design.
3. Write at most 10 short, value-oriented stories ("Como <rol>, quiero <acción>, para <beneficio>"). Keep the first slice usable end-to-end, where applicable.
4. Capture *real* dependencies only; avoid a "database first, then API, then UI" backlog. Security, migration and maintenance work can be standalone technical tasks when they are not honestly user stories.
5. Prioritize using the native Adaptive Decision Core's documented criteria/weights and blocking constraints. Never invent probabilities, scores, approvals or estimates.
6. Suggest, don't execute: present the lean backlog, mark uncertainty, and obtain any required milestone decision.

Output: concise context, stories/tasks, necessary dependencies, candidate first slice and open questions. No code, no premature comprehensive technical plan, no new file unless requested.

A story is not an execution grant; do not create workers, merge, deploy, push or access credentials from this skill.
