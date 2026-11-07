import { describe, expect, it } from 'vitest'
import {
  HUB_AGENT_PROFILES, hubAgentSoul, type HubAgentProfile
} from './project-hub-agent-profiles'

const boundaries: Record<HubAgentProfile, string> = {
  atlas: 'no generes DAG',
  forge: 'no amplíes alcance',
  flow: 'No amplíes la automatización',
  data: 'No expandas exploraciones',
  qa: 'Limita la revisión'
}

describe('Project Hub bundled SOUL profiles stay bounded', () => {
  it.each(HUB_AGENT_PROFILES)('%s is loaded, concise and scope-limited', profile => {
    const soul = hubAgentSoul(profile)
    expect(soul).toContain('SOUL.md')
    expect(soul).toContain(boundaries[profile])
    expect(soul.length).toBeLessThanOrEqual(4_000)
  })
})
