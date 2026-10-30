import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUserCli } from '../src/arw-ai-cli/user-cli'
import { execGitFixture } from './git-fixture-exec'

test('user CLI survives loss of the AI session PATH and preserves foreign commands', { skip: process.platform === 'win32' }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'arw-user-cli-'))
    try {
        const source = join(home, 'arw.cjs')
        await writeFile(source, '#!/bin/sh\nprintf "arw-ready"\n')
        await ensureUserCli(source, home)
        await ensureUserCli(source, home)
        const result = await execGitFixture('/bin/sh', ['-c', `PATH="$HOME/.local/bin:/usr/bin:/bin" arw`.replace('$HOME', home)])
        assert.equal(result.stdout, 'arw-ready')
        await rm(join(home, '.local/bin/arw'))
        await writeFile(join(home, '.local/bin/arw'), 'foreign')
        await assert.rejects(ensureUserCli(source, home), /未覆盖/)
        assert.equal(await readFile(join(home, '.local/bin/arw'), 'utf8'), 'foreign')
    } finally { await rm(home, { recursive: true, force: true }) }
})
