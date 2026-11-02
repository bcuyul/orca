import type { IntentAssessment } from './decision-contracts'

export type AdaptiveRouteEvidence = {
  /** Evidence-backed understanding of the requested change, never model authority. */
  understood: boolean
  /** Could a new session resume with the request and actual git diff alone? */
  resumableFromDiff: boolean
  /** Waiting for an external decision or system outside the repository. */
  externalWait: boolean
  /** Needs more exploration than one bounded inline read pass. */
  extendedExploration: boolean
  /** Units each independently deliver behavior plus their own tests. */
  independentUnits: number
  /** Independent units cannot write overlapping code. */
  disjointEditSurfaces: boolean
  /** Each unit saves meaningful work after a new agent reads the repo. */
  substantialIndependentUnits: boolean
  /** Current session lacks enough context for the next bounded unit. */
  contextBackstop: boolean
}
export type AdaptiveRoutingDecision = {
  route: 'direct_inline' | 'delegated_direct' | 'clarify_first' | 'read_only'
  record: 'diff_only' | 'recoverable_feature'
  delegateFor: ('exploration' | 'parallel_writers' | 'context_backstop' | 'independent_verifier')[]
  humanGate: IntentAssessment['humanGate']
  reasons: string[]
  executionAuthorized: false
}

const readOnlyKinds = new Set(['research'])
const validGates = new Set(['not_required', 'recommended', 'mandatory'])
const validRisk = new Set(['low', 'medium', 'high', 'critical'])

/**
 * ODD-inspired, advisory routing. Whether to document, delegate and execute are
 * three separate decisions. No model output grants host authority.
 */
export function routeAdaptiveWork(
  intent: IntentAssessment,
  evidence: AdaptiveRouteEvidence
): AdaptiveRoutingDecision {
  if (!intent || !validRisk.has(intent.risk) || !validGates.has(intent.humanGate) ||
      intent.executionAuthorized !== false || !evidence ||
      [evidence.understood, evidence.resumableFromDiff, evidence.externalWait,
        evidence.extendedExploration, evidence.disjointEditSurfaces,
        evidence.substantialIndependentUnits, evidence.contextBackstop]
        .some(value => typeof value !== 'boolean') ||
      !Number.isSafeInteger(evidence.independentUnits) ||
      evidence.independentUnits < 0 || evidence.independentUnits > 20) {
    throw new Error('invalid_advisory_routing_evidence')
  }
  const record = !evidence.resumableFromDiff || evidence.externalWait
    ? 'recoverable_feature' : 'diff_only'
  const delegateFor: AdaptiveRoutingDecision['delegateFor'] = []
  if (evidence.extendedExploration) { delegateFor.push('exploration') }
  if (evidence.independentUnits >= 2 && evidence.disjointEditSurfaces &&
      evidence.substantialIndependentUnits) { delegateFor.push('parallel_writers') }
  if (evidence.contextBackstop) { delegateFor.push('context_backstop') }
  if (intent.risk === 'high' || intent.risk === 'critical') {
    delegateFor.push('independent_verifier')
  }
  // Risk classification may never be weakened by a forged advisory gate.
  const humanGate: IntentAssessment['humanGate'] =
    intent.risk === 'high' || intent.risk === 'critical' ? 'mandatory' : intent.humanGate
  const readOnly = readOnlyKinds.has(intent.kind)
  // An unclear scope may be investigated, but not executed as invented requirements.
  const route: AdaptiveRoutingDecision['route'] = readOnly ? 'read_only' :
    !evidence.understood ? 'clarify_first' :
      delegateFor.length > 0 ? 'delegated_direct' : 'direct_inline'
  const reasons = [
    record === 'diff_only'
      ? 'request + diff are sufficient to resume: no feature document'
      : 'resume needs information outside the diff: durable feature record',
    delegateFor.length
      ? `named delegation reasons: ${delegateFor.join(', ')}`
      : 'no justified subagent: execute inline if separately authorized',
    route === 'clarify_first' ? 'unclear scope: do not write until clarified' :
      'routing is advisory, never execution consent'
  ]
  return { route, record, delegateFor, humanGate,
    reasons, executionAuthorized: false }
}
