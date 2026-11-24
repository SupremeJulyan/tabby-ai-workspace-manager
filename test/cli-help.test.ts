import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { commands } from '../src/arw-cli/commands'

const execute = promisify(execFile)
const cli = (...args: string[]) => execute(process.execPath, [resolve('dist/arw.cjs'), ...args], {
  env: {...process.env, TABBY_CONFIG_DIRECTORY: '/missing/arw-help-config'},
})

test('top-level help is a short usage summary; every command has offline help without an ID', async () => {
  const top = (await cli('--help')).stdout
  assert.ok(top.split('\n').length <= 32)
  assert.match(top, /arw COMMAND/)
  for (const command of Object.keys(commands)) {
    const {stdout} = await cli(command, '--help')
    assert.match(stdout, new RegExp(`^Usage: arw ${command}(?:\\s|$)`))
    assert.notEqual(stdout, top)
    assert.equal(stdout.trim().split('\n').length, 1)
  }
  assert.equal((await cli('read', '-h')).stdout, (await cli('read', '--help')).stdout)
  await assert.rejects(cli('nonexistent', '--help'), /Unsupported command/)
})
