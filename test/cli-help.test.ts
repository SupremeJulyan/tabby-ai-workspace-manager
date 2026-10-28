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

test('top-level help is a short index; every command has offline help without an ID', async () => {
  const top = (await cli('--help')).stdout
  assert.ok(top.split('\n').length <= 20)
  assert.match(top, /COMMAND --help/)
  for (const command of Object.keys(commands)) {
    const {stdout} = await cli(command, '--help')
    assert.match(stdout, new RegExp(`^Usage: arw ${command} `))
    assert.notEqual(stdout, top)
  }
  assert.equal((await cli('read', '-h')).stdout, (await cli('read', '--help')).stdout)
  await assert.rejects(cli('nonexistent', '--help'), /Unsupported command/)
})

test('command help keeps operation-specific rules out of the index', async () => {
  assert.match((await cli('edit', '--help')).stdout, /match exactly once/)
  assert.match((await cli('search', '--help')).stdout, /JavaScript regular expressions/)
  assert.match((await cli('output', '--help')).stdout, /nextOffset/)
  assert.match((await cli('download', '--help')).stdout, /do not overwrite/)
})
