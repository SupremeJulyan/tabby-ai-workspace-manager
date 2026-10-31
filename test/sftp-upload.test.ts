import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Subject} from 'rxjs'
import {uploadLocalPaths, droppedLocalPaths} from '../src/adapters/sftp-upload'
import {localWorkspace} from '../src/arw-tree/workspace'
import {sftpFixture} from './sftp-copy-fixture'
import type {SSHSession} from '../src/adapters/ssh-compat'

test('desktop uploads preserve nested and empty directories, stream binary files, and refuse collisions', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arw-drop-'))
    t.after(() => rm(root, {recursive: true, force: true}))
    const source = join(root, 'local'), remote = join(root, 'remote')
    await mkdir(join(source, 'folder', 'empty'), {recursive: true}); await mkdir(remote)
    const bytes = Buffer.alloc(700000, 123)
    await writeFile(join(source, 'folder', 'binary'), bytes)
    await writeFile(join(source, 'single'), 'hello')
    const closed = new Subject<void>(); let refs = 0
    const session = {open: true, ref(){refs++}, unref(){refs--}, willDestroy$: closed,
        openSFTP: async () => sftpFixture()} as unknown as SSHSession
    const workspace = localWorkspace(remote), signal = new AbortController().signal
    await uploadLocalPaths(session, workspace, [join(source, 'folder'), join(source, 'single')], '.', signal)
    assert.deepEqual(await readFile(join(remote, 'folder', 'binary')), bytes)
    assert.deepEqual(await readdir(join(remote, 'folder', 'empty')), [])
    await assert.rejects(uploadLocalPaths(session, workspace, [join(source, 'single')], '.', signal), /exists/)
    assert.equal(await readFile(join(remote, 'single'), 'utf8'), 'hello')
    assert.equal(refs, 0)
    await assert.rejects(uploadLocalPaths(session, workspace, [join(source, 'single')], '../', signal), /outside|escape|boundary/i)
    const controller = new AbortController()
    await assert.rejects(uploadLocalPaths(session, workspace, [join(source, 'single')], '.', controller.signal, () => controller.abort()))
    assert.equal(refs, 0)
})

test('desktop drops resolve native paths, deduplicate entries, and reject missing paths', () => {
    const files = [{name: 'a'}, {name: 'a'}] as unknown as FileList
    assert.deepEqual(droppedLocalPaths(files, file => `/local/${file.name}`), ['/local/a'])
    assert.throws(() => droppedLocalPaths(files, () => ''), /local file path/)
})
