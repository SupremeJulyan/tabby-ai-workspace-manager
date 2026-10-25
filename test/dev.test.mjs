import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('development loader isolates release files from workspace host dependencies', { skip: process.platform === 'win32' }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-dev-test-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const executable = join(directory, 'tabby-fixture')
    await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const root = process.env.TABBY_PLUGINS;
const plugin = require('node:path').join(root, 'tabby-ai-workspace-manager');
console.log(JSON.stringify({root, entry: fs.existsSync(plugin+'/dist/index.js'),
    dependencies: fs.existsSync(plugin+'/node_modules'), source: fs.existsSync(plugin+'/src'),
    args: process.argv.slice(2), config: process.env.TABBY_CONFIG_DIRECTORY}));
`, { mode: 0o755 })
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/dev.mjs', import.meta.url)), executable], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.entry, true)
    assert.equal(report.dependencies, false)
    assert.equal(report.source, false)
    assert.ok(report.args.some(argument => argument.startsWith('--user-data-dir=')))
    assert.ok(report.config)
    await assert.rejects(access(report.root))
})
