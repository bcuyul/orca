import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveDevFreshPnpmCommand } from './dev-fresh-pnpm-command.mjs'

test('Windows uses Node to launch the pnpm JavaScript entrypoint, preserving arguments', () => {
  const cmd = resolveDevFreshPnpmCommand({
    platform: 'win32',
    nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
    npmExecPath: 'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
    devArgs: ['--shared-profile']
  })
  assert.deepEqual(cmd, {
    program: 'C:\\Program Files\\nodejs\\node.exe',
    args: [
      'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs',
      'dev',
      '--shared-profile'
    ]
  })
})

test('POSIX uses unchanged pnpm launcher', () => {
  assert.deepEqual(
    resolveDevFreshPnpmCommand({ platform: 'linux', devArgs: ['--worktree-profile'] }),
    { program: 'pnpm', args: ['dev', '--worktree-profile'] }
  )
})

test('Windows refuses missing or shell-shim entrypoints instead of spawning cmd.exe', () => {
  for (const npmExecPath of [undefined, 'pnpm.cmd', 'C:\\Tools\\pnpm.cmd', 'relative\\pnpm.cjs']) {
    assert.throws(
      () => resolveDevFreshPnpmCommand({ platform: 'win32', npmExecPath }),
      /Windows dev:fresh requires a pnpm JavaScript entrypoint/
    )
  }
})
