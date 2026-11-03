import type { HubPlanTask } from './project-hub-intelligence'

/** Host-generated, read-only projection. No execution authorization. */
export type NativePlanPreview = {
  projectId: string
  revision: number
  planId: string
  planSha: string
  objective: string
  approval: 'pending' | 'accepted' | 'rejected'
  tasks: Pick<HubPlanTask, 'id' | 'title' | 'role' | 'acceptance' | 'dependsOn'>[]
  dispatched: false
}
