/** Staged Adaptive plans are imported data, NOT executable work. Only a deny flag. */
export function isAdaptiveStagedTaskSpec(spec: string): boolean {
  if (!spec.startsWith('{')) { return false }
  try {
    const raw: unknown = JSON.parse(spec)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) &&
      'source' in raw && raw.source === 'adaptive-untrusted-plan'
  } catch {
    return false
  }
}
