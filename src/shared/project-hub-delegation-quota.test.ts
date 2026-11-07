import { describe, expect, it } from 'vitest'
import { createEmptyRateLimitState } from './rate-limit-state-factory'
import {
  estimateHubDelegationTokens, getHubProviderQuota,
  isHubDelegationTokenEstimate, roughHubPromptTokens,
  shareOfPlannedTokenBudget
} from './project-hub-delegation-quota'

const story = { title: 'Implement tiny feature', description: 'Feature description', acceptance: 'Tests pass' }
const now = 1_799_500_000_000

describe('Project Hub advisory tokens and real quota snapshots', () => {
  it('separates rough text tokens, an adjustable work scenario and a manual estimate', () => {
    const prompt = roughHubPromptTokens(story)
    const small = estimateHubDelegationTokens(story, 'small')
    const large = estimateHubDelegationTokens(story, 'large')
    expect(small).toMatchObject({
      promptTokens: prompt, totalTokens: prompt + 6000, source: 'scenario'
    })
    expect(large.totalTokens).toBeGreaterThan(small.totalTokens)
    expect(estimateHubDelegationTokens(story, 'standard', 12_500)).toEqual({
      promptTokens: prompt, totalTokens: 12_500, source: 'manual', scenario: 'standard'
    })
    expect(() => estimateHubDelegationTokens(story, 'small', prompt - 1)).toThrow()
    expect(() => estimateHubDelegationTokens(story, 'small', 5_000_001)).toThrow()
    expect(isHubDelegationTokenEstimate(small)).toBe(true)
    expect(isHubDelegationTokenEstimate({ ...small, totalTokens: -1 })).toBe(false)
  })
  it('only compares task tokens with a user-defined token budget', () => {
    expect(shareOfPlannedTokenBudget(12_000, 20_000)).toBe(60)
    expect(shareOfPlannedTokenBudget(12_000, null)).toBeNull()
    expect(shareOfPlannedTokenBudget(12_000, 4_000)).toBe(300)
    expect(() => shareOfPlannedTokenBudget(12_000, 0)).toThrow()
  })
  it('shows native Codex windows, never converts them into token allowance', () => {
    const state = createEmptyRateLimitState()
    state.codex = {
      provider: 'codex', status: 'ok', updatedAt: now, error: null,
      session: { usedPercent: 72, windowMinutes: 300, resetsAt: now + 3000, resetDescription: null },
      weekly: { usedPercent: 25, windowMinutes: 10080, resetsAt: null, resetDescription: null }
    }
    expect(getHubProviderQuota('codex', 'local', state, now)).toMatchObject({
      kind: 'verified', windows: [
        { name: 'Sesión', usedPercent: 72, remainingPercent: 28 },
        { name: 'Semanal', usedPercent: 25, remainingPercent: 75 }
      ]
    })
    expect(getHubProviderQuota('codex', 'remote', state, now).kind).toBe('unavailable')
    expect(getHubProviderQuota('codex', 'local', state, now + 16 * 60_000).kind).toBe('unavailable')
    expect(getHubProviderQuota('opencode', 'local', state, now).kind).toBe('unavailable')
    state.codexTarget = { runtime: 'wsl', wslDistro: 'Ubuntu' }
    expect(getHubProviderQuota('codex', 'local', state, now).kind).toBe('unavailable')
  })
  it('rejects error, expired, invalid and unverifiable quota readings', () => {
    const state = createEmptyRateLimitState()
    state.claude = {
      provider: 'claude', status: 'ok', updatedAt: now, error: null,
      session: { usedPercent: 123, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null
    }
    expect(getHubProviderQuota('claude', 'local', state, now).kind).toBe('unavailable')
    state.claude.session!.usedPercent = 40
    state.claude.usageMetadata = { unverifiableOwner: true }
    expect(getHubProviderQuota('claude', 'local', state, now).kind).toBe('unavailable')
    state.claude.usageMetadata = {}
    state.claude.status = 'error'
    expect(getHubProviderQuota('claude', 'local', state, now).kind).toBe('unavailable')
  })
})
