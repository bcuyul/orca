import type { OrchestrationDb } from './db'
import { isAdaptiveStagedTaskSpec } from './adaptive-staged-task'

/** Only native Tasks owned by this Run, excluding unlaunched Adaptive plans. */
export function listCoordinatorTasks(db: OrchestrationDb, taskRunId?: string) {
  return db.listTasks(taskRunId ? { runId: taskRunId } : undefined)
    .filter(task => !isAdaptiveStagedTaskSpec(task.spec))
}
