import type { IntentAssessment, WorkKind, RiskLevel } from './decision-contracts'

export type IntentRequest = { objective: string }

/**
 * Conservative bilingual lexical baseline. This is NOT semantic understanding;
 * ambiguous requests deliberately request a human planning decision. Never
 * downgrade security risk because a request says "simple" or "quick".
 */
const RULES: { kind: WorkKind; tokens: RegExp; strategy: IntentAssessment['planning'] }[] = [
  { kind: 'research', tokens: /\b(investig|research|compar|evaluate|evaluar|estudi|study|analiz|analy[sz]|explor|proof.of.concept|viabil)/, strategy: 'research_first' },
  { kind: 'project', tokens: /\b(desde cero|from scratch|aplicaci[oó]n completa|app completa|proyecto completo|full application|build an app|crear una aplicaci[oó]n|crear un crm|create a crm|desarrolla un crm|sistema completo)/, strategy: 'full_plan' },
  { kind: 'module', tokens: /\b(m[oó]dulo|module|subsistema|microservicio|microservice|facturaci[oó]n|inventario completo)/, strategy: 'bounded_dag' },
  { kind: 'use_case', tokens: /\b(caso de uso|use case|recuperar contrase[nñ]a|password reset|reset password|registro de usuarios|user registration|flujo completo|end.to.end|reservas|booking|reservaci[oó]n)/, strategy: 'bounded_dag' },
  { kind: 'microfix', tokens: /\b(corrig|arregl|fix|bug|ajust|change|cambia|modific|rename|renombr|typo|texto del bot[oó]n|bot[oó]n de guardar)/, strategy: 'direct' }
]

const highRisk = /\b(autenticaci[oó]n|authentication|password|contrase[nñ]a|permisos|permissions|credenciales|credentials|sesion|sesi[oó]n|login|inicio de sesi[oó]n|role-based|roles|acceso|access control|privilegios|privilege|tokens?|secretos|secrets?|encriptaci[oó]n|encryption|datos personales|personal data)/
const criticalRisk = /\b(producci[oó]n|production|deploy|despleg|migraci[oó]n de datos|data migration|borrar base|drop database|pagos?|payments?|tarjetas de cr[eé]dito|credit cards?|transferencia bancaria|bank transfer|desactivar seguridad|disable security)/
const multiScope = /\b(frontend|backend|api|base de datos|database|integraci[oó]n|integration|arquitectura|architecture|varios|multiple|todo el sistema|entire system)/
const questionSignals = /\b(quiz[aá]s|tal vez|maybe|whatever|lo que sea|no s[eé]|no se|decide t[uú]|you choose)/

export function analyzeIntent(input: IntentRequest): IntentAssessment {
  if (!input || typeof input.objective !== 'string' || input.objective.trim().length < 5 || input.objective.length > 4000) {
    throw new Error('objective must contain 5..4000 characters')
  }
  const raw = input.objective.toLowerCase().normalize('NFC')
  const rule = RULES.find(r => r.tokens.test(raw))
  const kind: WorkKind = rule?.kind ?? 'use_case'
  const risk: RiskLevel = criticalRisk.test(raw) ? 'critical' : highRisk.test(raw) ? 'high' : multiScope.test(raw) ? 'medium' : 'low'
  const weakIntent = rule === undefined
  const ambiguity: IntentAssessment['ambiguity'] = weakIntent || questionSignals.test(raw) ? 'high' :
    kind === 'project' || kind === 'module' ? 'medium' : 'low'
  const planning = rule?.strategy ?? 'bounded_dag'
  const humanGate = risk === 'high' || risk === 'critical' ? 'mandatory' :
    ambiguity === 'high' || kind === 'project' ? 'recommended' : 'not_required'
  const reasons = [
    rule ? `lexical signal: ${kind}` : 'no strong lexical signal; conservative use_case fallback',
    `risk signal: ${risk}; never reduces approval requirements`,
    ambiguity === 'high' ? 'ambiguous goal: human review recommended' : `planning scope: ${planning}`
  ]
  return { kind, risk, ambiguity, planning, humanGate, reasons, executionAuthorized: false }
}
