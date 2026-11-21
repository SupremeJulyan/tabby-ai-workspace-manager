import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { remoteSnapshotDiffCommand, remoteSnapshotRestoreCommand, saveRemoteSnapshot } from '../src/arw-cli/remote-snapshot'

const execute = promisify(execFile)

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
