import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveDevFreshPnpmCommand } from './dev-fresh-pnpm-command.mjs'

test('Windows retains the pnpm JS entrypoint and forwards args', () => {
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

test('POSIX uses the unchanged pnpm launcher', () => {
  assert.deepEqual(
    resolveDevFreshPnpmCommand({ platform: 'linux', devArgs: ['--worktree-profile'] }),
    { program: 'pnpm', args: ['dev', '--worktree-profile'] }
  )
})

test('Windows standalone pnpm falls back to a repository-owned Node runner without cmd', () => {
  for (const npmExecPath of [
    undefined, '', 'pnpm.cmd', 'C:\\Tools\\pnpm.cmd',
    'C:\\Tools\\pnpm.exe', 'relative\\pnpm.cjs'
  ]) {
    const cmd = resolveDevFreshPnpmCommand({
      platform: 'win32',
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
      npmExecPath,
      devArgs: ['--stable-name']
    })
    assert.equal(cmd.program, 'C:\\Program Files\\nodejs\\node.exe')
    assert.match(cmd.args[0], /dev-fresh-direct\.mjs$/)
    assert.deepEqual(cmd.args.slice(1), ['--stable-name'])
    assert.equal(cmd.args.some((arg) => /\.cmd$/i.test(arg)), false)
  }
})
