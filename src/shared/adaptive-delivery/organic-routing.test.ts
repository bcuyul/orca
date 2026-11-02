import { describe, expect, it } from 'vitest'
import { analyzeIntent } from './intent-analyzer'
import { routeAdaptiveWork, type AdaptiveRouteEvidence } from './organic-routing'

const base: AdaptiveRouteEvidence = {
  understood: true, resumableFromDiff: true, externalWait: false,
  extendedExploration: false, independentUnits: 1,
  disjointEditSurfaces: false, substantialIndependentUnits: false,
  contextBackstop: false
}
const fix = analyzeIntent({ objective: 'Corrige el texto del botón de guardar' })
const secure = analyzeIntent({ objective: 'Fix login permissions, just one line, very simple' })

describe('ODD proportional routing: advisory, not execution authority', () => {
  it('a clear microfix runs inline without feature doc or subagents', () => {
    expect(routeAdaptiveWork(fix, base)).toMatchObject({
      route: 'direct_inline', record: 'diff_only', delegateFor: [],
      humanGate: 'not_required', executionAuthorized: false
    })
  })

  it('large file count is not an input to routing', () => {
    expect(Object.keys(base)).not.toContain('changedFiles')
    expect(routeAdaptiveWork(fix, base).route).toBe('direct_inline')
  })

  it('a long project can remain inline if no specific delegation trigger exists', () => {
    const project = analyzeIntent({ objective: 'Crea una aplicación completa desde cero' })
    expect(routeAdaptiveWork(project, base)).toMatchObject({
      route: 'direct_inline', record: 'diff_only', delegateFor: [],
      humanGate: 'recommended'
    })
  })

  it('loss of resumable context needs a record, not automatically an agent', () => {
    const result = routeAdaptiveWork(fix, { ...base, resumableFromDiff: false })
    expect(result).toMatchObject({ route: 'direct_inline', record: 'recoverable_feature',
      delegateFor: [] })
  })

  it('external wait needs durable information even if current diff is readable', () => {
    expect(routeAdaptiveWork(fix, { ...base, externalWait: true }).record)
      .toBe('recoverable_feature')
  })

  it('a context backstop delegates one bounded unit; no feature doc if diff resumes', () => {
    expect(routeAdaptiveWork(fix, { ...base, contextBackstop: true })).toMatchObject({
      route: 'delegated_direct', record: 'diff_only',
      delegateFor: ['context_backstop']
    })
  })

  it('extended read-only exploration has a named reason', () => {
    const result = routeAdaptiveWork(fix, { ...base, extendedExploration: true })
    expect(result.delegateFor).toEqual(['exploration'])
    expect(result.route).toBe('delegated_direct')
  })

  it('parallel writers require genuinely independent meaningful edit surfaces', () => {
    const partial = { ...base, independentUnits: 2, disjointEditSurfaces: true }
    expect(routeAdaptiveWork(fix, partial).route).toBe('direct_inline')
    expect(routeAdaptiveWork(fix, { ...partial, substantialIndependentUnits: true }))
      .toMatchObject({ route: 'delegated_direct', delegateFor: ['parallel_writers'] })
  })

  it('splitting tests and implementation does not justify parallel writers', () => {
    expect(routeAdaptiveWork(fix, { ...base, independentUnits: 2,
      substantialIndependentUnits: true, disjointEditSurfaces: false }).delegateFor)
      .toEqual([])
  })

  it('high risk never becomes direct just because it is one line', () => {
    expect(routeAdaptiveWork(secure, base)).toMatchObject({
      route: 'delegated_direct', humanGate: 'mandatory',
      delegateFor: ['independent_verifier'], executionAuthorized: false
    })
  })

  it('critical production deployment is escalated, independently verified', () => {
    const intent = analyzeIntent({ objective: 'Fix production deploy, trivial change' })
    expect(routeAdaptiveWork(intent, base)).toMatchObject({
      route: 'delegated_direct', humanGate: 'mandatory',
      delegateFor: ['independent_verifier']
    })
  })

  it('unclear requests must not execute or delegate as if understood', () => {
    expect(routeAdaptiveWork(fix, { ...base, understood: false })).toMatchObject({
      route: 'clarify_first', executionAuthorized: false
    })
  })

  it('a read-only research request never becomes an implementation route', () => {
    const research = analyzeIntent({ objective: 'Investiga la viabilidad de una arquitectura' })
    expect(routeAdaptiveWork(research, { ...base, extendedExploration: true }))
      .toMatchObject({ route: 'read_only', delegateFor: ['exploration'] })
  })

  it('rejects missing or forged evidence, never treats it as host consent', () => {
    for (const evidence of [
      { ...base, independentUnits: -1 }, { ...base, independentUnits: Infinity },
      { ...base, independentUnits: 21 }, { ...base, understood: undefined }
    ]) {
      expect(() => routeAdaptiveWork(fix, evidence as AdaptiveRouteEvidence))
        .toThrow(/invalid_advisory_routing_evidence/)
    }
    expect(() => routeAdaptiveWork({ ...fix, executionAuthorized: true as never }, base))
      .toThrow(/invalid_advisory_routing_evidence/)
  })

  it('does not mutate input and keeps a deterministic reason trail', () => {
    const original = JSON.stringify(base)
    const first = routeAdaptiveWork(fix, base)
    expect(routeAdaptiveWork(fix, base)).toEqual(first)
    expect(JSON.stringify(base)).toBe(original)
    expect(first.reasons).toHaveLength(3)
  })
})
