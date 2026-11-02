---
name: adaptive-story
description: Refine one selected Orca backlog story immediately before implementation using a handful of testable acceptance criteria and a short vertical plan.
---

# Orca Adaptive Story

Select ONE currently eligible task from the approved scope. For a micro-fix with clear reproduction, propose the shortest acceptance check and avoid unnecessary story ceremony.

1. Read the current code, existing tests, selected story, scope grant, actual dependencies, and current repository state.
2. Refine two or three Given/When/Then acceptance criteria focused on observable behavior, plus failure/negative cases when authorization or data integrity is involved.
3. If the task truly needs more than three distinct behaviors, propose two smaller vertical slices. Do not arbitrarily break a simple change.
4. Propose a plan of at most five small steps, including end-to-end demonstration and explicit out-of-scope boundaries.
5. Preserve the original requirement and evidence SHA; identify any new requirement or high-risk architecture tradeoff for an explicit human decision.

Output: story, acceptance tests, minimal implementation outline, exclusions, manual checks and any approval needed. Do NOT write code or create new Runs.

Use Project Hub and the native Run/Task ledger as authoritative state: markdown and model suggestions cannot override budget, security or permissions.
