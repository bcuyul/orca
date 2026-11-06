import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Windows cannot spawn pnpm.cmd through process-host without a shell. */
export function resolveDevFreshPnpmCommand({
  platform = process.platform,
  nodeExecPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  devArgs = []
} = {}) {
  if (platform !== 'win32') {
    return { program: 'pnpm', args: ['dev', ...devArgs] }
  }

  // Node-backed pnpm exposes npm_execpath. Keep the normal pnpm dev path
  // when it is a real absolute JavaScript entrypoint.
  if (
    typeof npmExecPath === 'string' &&
    path.win32.isAbsolute(npmExecPath) &&
    /\.[cm]?js$/i.test(npmExecPath)
  ) {
    return { program: nodeExecPath, args: [npmExecPath, 'dev', ...devArgs] }
  }

  // Standalone/Corepack pnpm on Windows may leave npm_execpath absent or
  // point to a .cmd/.exe shim. Never invoke shell shims or infer PATH entries:
  // the parent dev:fresh script already built the workspace packages, so
  // mirror the remaining pnpm dev steps with a trusted repository-local
  // Node entrypoint. Forward the same runner args unchanged.
  const directRunner = fileURLToPath(new URL('./dev-fresh-direct.mjs', import.meta.url))
  return { program: nodeExecPath, args: [directRunner, ...devArgs] }
}
