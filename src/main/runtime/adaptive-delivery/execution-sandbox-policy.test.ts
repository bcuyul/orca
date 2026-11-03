import { describe, expect, it } from 'vitest'
import { requireVerifiedAgentSandbox, type AgentSandboxEvidence } from './execution-sandbox-policy'

const scope = { hostId: 'host-1', repoId: 'repo-1', worktreeId: 'wt-1',
  baseSha: 'a'.repeat(40) }
const accepted: AgentSandboxEvidence = {
  kind: 'os-enforced', sandboxId: 'sandbox-a',
  policyDigest: 'b'.repeat(64),
  filesystem: 'restricted', network: 'restricted', childProcesses: 'confined'
}
describe('worktrees are NOT a security boundary', () => {
  it('rejects absent attestation even when a valid worktree exists', () => {
    expect(() => requireVerifiedAgentSandbox({ inspectSandbox: () => null }, scope))
      .toThrow(/execution_sandbox_required/)
  })

  it('rejects worktree-only isolation, even with host source and valid SHA', () => {
    expect(() => requireVerifiedAgentSandbox({
      inspectSandbox: () => ({ kind: 'worktree-only' })
    }, scope)).toThrow(/worktree_is_not_a_security_boundary/)
  })

  it('rejects incomplete enforcement, missing policy digest and wrong process boundary', () => {
    for (const candidate of [
      { ...accepted, network: 'unrestricted' },
      { ...accepted, childProcesses: 'unconfined' },
      { ...accepted, policyDigest: 'not-a-digest' },
      { ...accepted, sandboxId: '' }
    ]) {
      expect(() => requireVerifiedAgentSandbox({
        // SAFETY: test intentionally supplies malformed evidence to verify fail-closed behavior.
        inspectSandbox: () => candidate as AgentSandboxEvidence
      }, scope)).toThrow(/execution_sandbox_required/)
    }
  })

  it('accepts a well-formed host attestation (but does not launch a sandbox)', () => {
    expect(() => requireVerifiedAgentSandbox({
      inspectSandbox: (actualScope) => {
        expect(actualScope).toEqual(scope)
        return accepted
      }
    }, scope)).not.toThrow()
  })
})
