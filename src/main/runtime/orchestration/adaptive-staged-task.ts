/** Staged Adaptive plans are imported data, NOT executable work. Only a deny flag. */
export function isAdaptiveStagedTaskSpec(spec: string): boolean {
  // JSON permits leading whitespace. Do not let formatting skip the
  // coordinator's staged-plan quarantine before any worker terminal is created.
  const trimmed = spec.trimStart()
  if (!trimmed.startsWith('{')) { return false }
  try {
    const raw: unknown = JSON.parse(trimmed)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) &&
      'source' in raw && raw.source === 'adaptive-untrusted-plan'
  } catch {
    return false
  }
}
