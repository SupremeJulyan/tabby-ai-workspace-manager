import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { remoteSnapshotDiffCommand, remoteSnapshotRestoreCommand, saveRemoteSnapshot } from '../src/arw-cli/remote-snapshot'

const execute = promisify(execFile)

test('clean tracked files reuse pinned blobs while dirty, ignored and filtered bytes use archives', {skip:process.platform !== 'linux'}, async t => {
  const home = await mkdtemp(join(tmpdir(), 'arw-git-reuse-'))
  t.after(() => rm(home, {recursive:true, force:true}))
  const root = await mkdtemp(join(home, 'workspace-'))
  const env = {...process.env, HOME:home}
  const run = (command: string) => execute('sh', ['-c', command], {env})
  const git = (...args: string[]) => execute('git', ['-C', root, ...args], {env})
  const repo = join(home, '.arw-snapshots', createHash('sha256').update(root).digest('hex') + '.git')
  const snapshotGit = (...args: string[]) => execute('git', ['--git-dir', repo, ...args], {env})
  const ref = (id: string) => 'refs/arw/snapshots/' + id
  const nested = join(root, 'nested')
  const file = join(nested, 'tracked.txt')
  const filtered = join(root, 'filtered.txt')
  const ignored = join(root, 'ignored.txt')
  await git('init', '-q')
  await mkdir(nested)
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(root, '.gitattributes'), 'filtered.txt text eol=crlf\n')
  await writeFile(file, 'base\n')
  await writeFile(filtered, 'line\r\n')
  await writeFile(ignored, 'private\n')
  await git('add', '.')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  await chmod(file, 0o640)
  const before = await saveRemoteSnapshot(run, root, 'remote_write', [file], true)
  const manifest = JSON.parse((await snapshotGit('show', ref(before) + ':manifest.json')).stdout)
  assert.equal(manifest.gitReference.mode, 0o640)
  assert.equal((await git('rev-parse', ref(before))).stdout.trim(), manifest.gitReference.oid)
  await assert.rejects(snapshotGit('cat-file', '-e', ref(before) + ':files.tar'))

  await writeFile(file, 'dirty\n')
  for (const target of [file, filtered, ignored]) {
    const id = await saveRemoteSnapshot(run, root, 'remote_write', [target], true)
    await snapshotGit('cat-file', '-e', ref(id) + ':files.tar')
  }
  await git('add', 'nested/tracked.txt')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'next')
  const after = await saveRemoteSnapshot(run, root, 'remote_write', [file])
  assert.match((await run(remoteSnapshotDiffCommand(root, before))).stdout, /^-base$/m)
  await run(remoteSnapshotRestoreCommand(root, before, after))
  assert.equal(await readFile(file, 'utf8'), 'base\n')
  assert.equal((await stat(file)).mode & 0o777, 0o640)
})

test('snapshot diff reads current files and restore preserves conflicting edits', {skip:process.platform !== 'linux'}, async t => {
  const home = await mkdtemp(join(tmpdir(), 'arw-snapshot-test-'))
  t.after(() => rm(home, {recursive:true, force:true}))
  const root = await mkdtemp(join(home, 'workspace-'))
  const run = (command: string) => execute('sh', ['-c', command], {env:{...process.env, HOME:home}})
  const file = join(root, 'notes.txt')
  const moved = join(root, 'moved.txt')
  await writeFile(file, 'before\n')
  const before = await saveRemoteSnapshot(run, root, 'remote_write', [file])
  await writeFile(file, 'after\n')
  const after = await saveRemoteSnapshot(run, root, 'remote_write', [file])
  const restore = remoteSnapshotRestoreCommand(root, before, after)
  await writeFile(file, 'manual edit\n')
  const diff = await run(remoteSnapshotDiffCommand(root, before))
  assert.match(diff.stdout, /^-before$/m)
  assert.match(diff.stdout, /^\+manual edit$/m)
  await assert.rejects(run(restore), /Files changed after the operation/)
  assert.equal(await readFile(file, 'utf8'), 'manual edit\n')

  const beforeMove = await saveRemoteSnapshot(run, root, 'remote_move', [file, moved])
  await rename(file, moved)
  const afterMove = await saveRemoteSnapshot(run, root, 'remote_move', [file, moved])
  await run(remoteSnapshotRestoreCommand(root, beforeMove, afterMove))
  assert.equal(await readFile(file, 'utf8'), 'manual edit\n')
  await assert.rejects(readFile(moved), {code:'ENOENT'})

  const dir = join(root, 'empty')
  await mkdir(dir)
  const deleted = await saveRemoteSnapshot(run, root, 'remote_delete', [file, dir])
  await rm(file)
  await rm(dir, {recursive:true})
  await run(remoteSnapshotRestoreCommand(root, deleted))
  assert.equal(await readFile(file, 'utf8'), 'manual edit\n')
  await assert.rejects(run(remoteSnapshotRestoreCommand(root, deleted)), /A deleted path now exists/)
})
