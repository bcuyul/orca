/** Repository-owned SOUL profiles; bundled as text, not read from user-controlled paths.
 * A profile is guidance and never grants tools, execution authority, or credentials. */
import atlasSoul from './project-hub-souls/atlas/SOUL.md?raw'
import forgeSoul from './project-hub-souls/forge/SOUL.md?raw'
import flowSoul from './project-hub-souls/flow/SOUL.md?raw'
import dataSoul from './project-hub-souls/data/SOUL.md?raw'
import qaSoul from './project-hub-souls/qa/SOUL.md?raw'

export const HUB_AGENT_PROFILES = ['atlas', 'forge', 'flow', 'data', 'qa'] as const
export type HubAgentProfile = (typeof HUB_AGENT_PROFILES)[number]

export const HUB_AGENT_PROFILE_LABELS: Record<HubAgentProfile, string> = {
  atlas: 'Atlas · arquitectura',
  forge: 'Forge · desarrollo',
  flow: 'Flow · automatización',
  data: 'Data · datos',
  qa: 'QA · revisión'
}

const SOULS: Record<HubAgentProfile, string> = {
  atlas: atlasSoul,
  forge: forgeSoul,
  flow: flowSoul,
  data: dataSoul,
  qa: qaSoul
}

export function isHubAgentProfile(value: unknown): value is HubAgentProfile {
  return HUB_AGENT_PROFILES.some((candidate) => candidate === value)
}

/** Legacy plans without a profile retain deterministic Forge guidance if ever rendered. */
export function hubAgentSoul(profile: HubAgentProfile | undefined): string {
  const text = SOULS[profile ?? 'forge']
  if (!text || text.length > 4000) {
    throw new Error('Invalid Project Hub SOUL profile')
  }
  return text.trim()
}
