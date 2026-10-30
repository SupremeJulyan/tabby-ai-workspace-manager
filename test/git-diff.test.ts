import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteGit } from '../src/arw-tree/git/remote-git'
import { parseDiff, addedFilePatch } from '../src/arw-tree/git/diff-model'
import { execGitFixture } from './git-fixture-exec'

test('diff model preserves line numbers and aligns replacement blocks', () => {
    const diff = parseDiff('diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -3,3 +3,4 @@ function\n same\n-before\n+after\n+extra\n last\n')
    assert.equal(diff.added, 2); assert.equal(diff.removed, 1)
    assert.deepEqual(diff.hunks[0].rows.map(row => [row.old?.oldNumber, row.next?.newNumber]), [[3,3],[4,4],[undefined,5],[5,6]])
    assert.equal(diff.hunks[0].rows[1].old?.text, 'before')
    assert.equal(diff.hunks[0].rows[1].next?.text, 'after')
})

test('diff model counts hunk bodies instead of interpreting file-like content as headers', () => {
    const diff = parseDiff('@@ -1,2 +1,2 @@\n--- a/fake\n-diff --git a/old b/new\n+++ b/fake\n+@@ -50 +50 @@\n')
    assert.equal(diff.hunks.length, 1)
    assert.equal(diff.hunks[0].lines[0].text, '-- a/fake')
    assert.equal(diff.hunks[0].lines[2].text, '++ b/fake')
    assert.equal(diff.added, 2); assert.equal(diff.removed, 2)
    assert.throws(() => parseDiff('@@ -1,2 +1,2 @@\n only-one\n'), /不完整/)
})

test('diff model supports untracked, empty, binary, renamed, deleted and no-newline files', () => {
    for (const text of ['', 'hello', 'hello\n', 'hello\r\n', '<img src=x onerror=alert(1)>']) {
        const diff = parseDiff(addedFilePatch(text))
        assert.equal(diff.removed, 0)
        assert.equal(diff.added, text ? 1 : 0)
    }
    assert.equal(parseDiff(addedFilePatch('hello')).hunks[0].lines.at(-1)?.kind, 'note')
    assert.equal(parseDiff(addedFilePatch('hello\r\n')).hunks[0].lines[0].text, 'hello␍')
    assert.equal(parseDiff(addedFilePatch('hello')).hunks[0].rows.at(-1)?.old, undefined)
    assert.throws(() => parseDiff('\n'.repeat(20_000)), /超过 20000 行/)
    assert.equal(parseDiff('Binary files a/file and b/file differ\n').binary, true)
    assert.equal(parseDiff('diff --cc file\n@@@ -1 -1 +1 @@@\n++ conflict\n').combined, true)
    assert.equal(parseDiff('rename from old\nrename to new\n').metadata.length, 2)
    const deleted = parseDiff('@@ -1,2 +0,0 @@\n-one\n-two\n')
    assert.equal(deleted.removed, 2)
    assert.ok(deleted.hunks[0].rows.every(row => row.next === undefined))
})

test('Git discard preserves the index, staged renames and unselected untracked files', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arw-git-discard-'))
    t.after(() => rm(root, {recursive: true, force: true}))
    const git = new RemoteGit(async command => {
        try {return {...await execGitFixture('/bin/sh', ['-c', command], {cwd: root}), exitCode: 0}}
        catch (error) {const result=error as {code: number; stdout: string; stderr: string}; return {...result, exitCode: result.code}}
    })
    await git.run(['init'])
    await git.run(['config', 'user.name', 'ARW Test']); await git.run(['config', 'user.email', 'arw@example.test'])
    await writeFile(join(root, 'file'), 'base\n'); await git.run(['add', '.']); await git.commit('base')
    await writeFile(join(root, 'file'), 'staged\n'); await git.stage(await git.status())
    await writeFile(join(root, 'file'), 'unstaged\n')
    let changes = await git.status()
    assert.match(await git.diff(changes[0], true), /\+staged/)
    assert.match(await git.diff(changes[0], false), /\+unstaged/)
    await git.discard(changes)
    assert.equal(await readFile(join(root, 'file'), 'utf8'), 'staged\n')
    assert.equal(await git.run(['show', ':file']), 'staged\n')
    await git.commit('staged')
    await git.run(['mv', 'file', 'renamed file'])
    await writeFile(join(root, 'renamed file'), 'modified again\n')
    changes = await git.status(); assert.equal(changes[0].index, 'R')
    await git.discard(changes)
    assert.equal(await readFile(join(root, 'renamed file'), 'utf8'), 'staged\n')
    assert.equal((await git.status())[0].index, 'R')
    await writeFile(join(root, 'new [a].txt'), 'selected')
    await writeFile(join(root, 'new a.txt'), 'keep')
    const selected = (await git.status()).find(change => change.path === 'new [a].txt')!
    await git.discard([selected])
    await assert.rejects(readFile(join(root, 'new [a].txt')))
    assert.equal(await readFile(join(root, 'new a.txt'), 'utf8'), 'keep')
    await mkdir(join(root,'plain [a]'))
    await writeFile(join(root,'plain [a]/file'),'delete selected directory')
    await git.discard([{index:'?',working:'?',path:'plain [a]/'}])
    await assert.rejects(access(join(root,'plain [a]')))
    await mkdir(join(root,'test'))
    await git.run(['-C',join(root,'test'),'init'])
    await writeFile(join(root,'test/file'),'nested project')
    const nested=(await git.status()).find(change=>change.path==='test/')!
    assert.ok(nested)
    await assert.rejects(git.discard([nested]),/独立 Git 仓库/)
    await access(join(root,'test/.git'))
    assert.equal(await readFile(join(root,'test/file'),'utf8'),'nested project')
    await assert.rejects(git.discard([{index:'U',working:'U',path:'renamed file'}]), /冲突/)
})

test('Git diff ignores external diff and text conversion tools', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arw-safe-diff-'))
    t.after(() => rm(root, {recursive: true, force: true}))
    const git = new RemoteGit(async command => {
        try {return {...await execGitFixture('/bin/sh', ['-c', command], {cwd: root}), exitCode: 0}}
        catch (error) {const result=error as {code: number; stdout: string; stderr: string}; return {...result, exitCode: result.code}}
    })
    await git.run(['init']); await git.run(['config', 'user.name', 'ARW Test']); await git.run(['config', 'user.email', 'arw@example.test'])
    await writeFile(join(root, 'file [a]'), 'before\n'); await git.run(['add', '.']); await git.commit('base')
    await git.run(['config', 'diff.external', 'this-must-not-be-executed'])
    await writeFile(join(root, 'file [a]'), 'after\n')
    const patch = await git.diff((await git.status())[0], false)
    assert.equal(parseDiff(patch).added, 1)
    assert.match(patch, /\+after/)
})
