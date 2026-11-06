#!/usr/bin/env node
/**
 * Shell-free Windows fallback for pnpm dev:fresh when pnpm was installed as
 * a standalone executable and did not export a JS npm_execpath.
 *
 * Parent package script already ran build:packages. Reproduce the remaining
 * "pnpm dev" steps: prepare Electron-native modules, then launch Electron Vite.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { spawnProcess } from '@orca/process-host'

const repoRoot = resolve(import.meta.dirname, '../..')
const scriptsDir = resolve(import.meta.dirname)
const node = process.execPath

console.error('[dev-fresh-profile] Standalone pnpm detected; using shell-free Node launcher')
const prep = spawnSync(
  node,
  [resolve(scriptsDir, 'ensure-native-runtime.mjs'), '--runtime=electron'],
  { cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true }
)
if (prep.error) {
  console.error('[dev-fresh-profile] Native Electron preparation failed:', prep.error)
  process.exit(1)
}
if (prep.status !== 0) {
  process.exit(prep.status ?? 1)
}

const child = spawnProcess({
  program: node,
  args: [resolve(scriptsDir, 'run-electron-vite-dev.mjs'), ...process.argv.slice(2)],
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit'
})
// Ctrl+C is delivered to the shared console process group on Windows; do not
// turn it into a second forwarded signal. SIGTERM is an explicit shutdown.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
child.on('error', (error) => {
  console.error('[dev-fresh-profile] Electron dev launch failed:', error)
  process.exitCode = 1
})
