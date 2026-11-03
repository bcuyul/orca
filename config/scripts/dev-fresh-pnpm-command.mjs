import path from 'node:path'

/** Windows cannot spawn the pnpm.cmd shim as a bare executable through the process host. */
export function resolveDevFreshPnpmCommand({
  platform = process.platform,
  nodeExecPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  devArgs = []
} = {}) {
  if (platform !== 'win32') {
    return { program: 'pnpm', args: ['dev', ...devArgs] }
  }

  // pnpm sets npm_execpath to its JavaScript entrypoint when executing package scripts.
  // Launch that entrypoint through Node rather than relying on Windows .CMD shims.
  if (
    typeof npmExecPath !== 'string' ||
    !path.win32.isAbsolute(npmExecPath) ||
    !/\.[cm]?js$/i.test(npmExecPath)
  ) {
    throw new Error(
      'Windows dev:fresh requires a pnpm JavaScript entrypoint (npm_execpath). ' +
        'Instead set ORCA_DEV_USER_DATA_PATH to a separate directory and run pnpm dev.'
    )
  }
  return { program: nodeExecPath, args: [npmExecPath, 'dev', ...devArgs] }
}
