/** Git worktrees isolate Git state, not a process's filesystem or network access. */
export type AgentSandboxEvidence =
  | { kind: 'worktree-only' }
  | {
      kind: 'os-enforced'
      sandboxId: string
      filesystem: 'restricted'
      network: 'restricted'
      childProcesses: 'confined'
      /** Host-side evidence identity, not a value supplied by the agent. */
      policyDigest: string
    }

export type VerifiedAgentSandboxReader = {
  /** Implement in the trusted host runtime; do not expose this over RPC. */
  inspectSandbox(input: {
    hostId: string
    repoId: string
    worktreeId: string
    baseSha: string
  }): AgentSandboxEvidence | null
}

/** Preflight only. The actual launch path MUST enforce the same policy again. */
export function requireVerifiedAgentSandbox(
  reader: VerifiedAgentSandboxReader,
  input: { hostId: string; repoId: string; worktreeId: string; baseSha: string }
): void {
  const evidence = reader.inspectSandbox(input)
  if (!evidence || evidence.kind !== 'os-enforced' ||
      evidence.filesystem !== 'restricted' ||
      evidence.network !== 'restricted' ||
      evidence.childProcesses !== 'confined' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(evidence.sandboxId) ||
      !/^[0-9a-f]{64}$/i.test(evidence.policyDigest)) {
    throw new Error('execution_sandbox_required:worktree_is_not_a_security_boundary')
  }
}
