/** Advisory-only delegated task token scenarios and real provider quota snapshots.
 * Quota windows are NOT denominated in tokens and must never be used to
 * convert estimated tokens into a subscription-quota percentage.
 */
import type { HubItem } from './project-hub-types'
import type { HubCliAgent } from './project-hub-delegation'
import type { ProviderRateLimits, RateLimitState, RateLimitWindow } from './rate-limit-types'

export const HUB_TOKEN_SCENARIOS = ['small', 'standard', 'large'] as const
export type HubTokenScenario = (typeof HUB_TOKEN_SCENARIOS)[number]
export type HubDelegationTokenEstimate = {
  totalTokens: number
  promptTokens: number
  scenario: HubTokenScenario
  source: 'scenario' | 'manual'
}
export const HUB_MAX_TASK_TOKENS = 5_000_000

// These are adjustable planning assumptions, NOT measured/model-specific forecasts.
const SCENARIO_WORK_TOKENS: Record<HubTokenScenario, number> = {
  small: 6_000, standard: 18_000, large: 45_000
}

/** A rough lower-bound for prompt text only, not repository context or agent work. */
export function roughHubPromptTokens(item: Pick<HubItem, 'title' | 'description' | 'acceptance'>): number {
  const chars = [item.title, item.description, item.acceptance].join('\n').length
  return Math.max(1, Math.ceil(chars / 4))
}

export function isHubDelegationTokenEstimate(value: unknown): value is HubDelegationTokenEstimate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false }
  const v = value as Record<string, unknown>
  return Number.isSafeInteger(v.totalTokens) && Number(v.totalTokens) >= 1 &&
    Number(v.totalTokens) <= HUB_MAX_TASK_TOKENS &&
    Number.isSafeInteger(v.promptTokens) && Number(v.promptTokens) >= 1 &&
    Number(v.promptTokens) <= Number(v.totalTokens) &&
    HUB_TOKEN_SCENARIOS.some(s => s === v.scenario) &&
    (v.source === 'manual' || v.source === 'scenario')
}

export function estimateHubDelegationTokens(
  item: Pick<HubItem, 'title' | 'description' | 'acceptance'>,
  scenario: HubTokenScenario = 'standard',
  overrideTokens?: number
): HubDelegationTokenEstimate {
  if (!HUB_TOKEN_SCENARIOS.includes(scenario)) { throw new Error('Invalid workload scenario') }
  const promptTokens = roughHubPromptTokens(item)
  if (overrideTokens !== undefined && (!Number.isSafeInteger(overrideTokens) ||
    overrideTokens < promptTokens || overrideTokens > HUB_MAX_TASK_TOKENS)) {
    throw new Error('Estimated tokens must cover prompt and be a bounded positive integer')
  }
  const estimate: HubDelegationTokenEstimate = {
    promptTokens, scenario,
    totalTokens: overrideTokens ?? Math.min(HUB_MAX_TASK_TOKENS, promptTokens + SCENARIO_WORK_TOKENS[scenario]),
    source: overrideTokens === undefined ? 'scenario' : 'manual'
  }
  return estimate
}

/** A planned-token budget is user supplied; this is not provider quota usage. */
export function shareOfPlannedTokenBudget(tokens: number, budget: number | null): number | null {
  if (!Number.isSafeInteger(tokens) || tokens < 0) { throw new Error('Invalid planned tokens') }
  if (budget === null) { return null }
  if (!Number.isSafeInteger(budget) || budget < 1) { throw new Error('Invalid token budget') }
  return Math.round((tokens / budget) * 1000) / 10
}

export type HubQuotaWindow = {
  name: 'Sesión' | 'Semanal' | 'Mensual'
  usedPercent: number
  remainingPercent: number
  resetsAt: number | null
}
export type HubProviderQuota = {
  kind: 'verified' | 'unavailable'
  providerLabel: string
  windows: HubQuotaWindow[]
  note: string
}

function quotaWindow(name: HubQuotaWindow['name'], value: RateLimitWindow | null | undefined): HubQuotaWindow | null {
  if (!value || !Number.isFinite(value.usedPercent) ||
      value.usedPercent < 0 || value.usedPercent > 100) { return null }
  const used = Math.round(value.usedPercent * 10) / 10
  return { name, usedPercent: used, remainingPercent: Math.round((100 - used) * 10) / 10,
    resetsAt: value.resetsAt }
}

/**
 * Display only quota owned by the selected LOCAL host/CLI. OpenCode's generic
 * CLI can use many different billing accounts; OpenCode Go is not a safe alias.
 */
export function getHubProviderQuota(
  agent: HubCliAgent,
  hostId: string,
  state: RateLimitState,
  nowMs = Date.now()
): HubProviderQuota {
  const name = agent === 'codex' ? 'Codex' :
    agent === 'claude' ? 'Claude' : agent === 'opencode' ? 'OpenCode' : 'Hermes'
  const unavailable = (note: string): HubProviderQuota => ({
    kind: 'unavailable', providerLabel: name, windows: [], note
  })
  if (hostId !== 'local') { return unavailable('Host de cuota no verificado; no usar métricas locales') }
  if (agent !== 'codex' && agent !== 'claude') {
    return unavailable('Sin cuenta de cuota universal asociada a este CLI; requiere proveedor/modelo')
  }
  const target = agent === 'codex' ? state.codexTarget : state.claudeTarget
  if (target.runtime !== 'host') {
    return unavailable('La cuota corresponde a WSL, no al CLI local seleccionado')
  }
  const provider: ProviderRateLimits | null = agent === 'codex' ? state.codex : state.claude
  if (!provider || provider.status !== 'ok' || provider.usageMetadata?.unverifiableOwner ||
      provider.usageMetadata?.ownerNotSetUp ||
      !Number.isFinite(provider.updatedAt) || provider.updatedAt > nowMs ||
      nowMs - provider.updatedAt > 15 * 60_000) {
    return unavailable('Cuota ausente, obsoleta o sin verificación reciente')
  }
  const windows = [
    quotaWindow('Sesión', provider.session),
    quotaWindow('Semanal', provider.weekly),
    quotaWindow('Mensual', provider.monthly)
  ].filter((window): window is HubQuotaWindow => window !== null)
  return windows.length
    ? { kind: 'verified', providerLabel: name, windows,
        note: 'Porcentaje real de ventanas temporales; no equivale a tokens disponibles' }
    : unavailable('El proveedor no publicó ventanas de cuota')
}
