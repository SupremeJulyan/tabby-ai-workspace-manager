import { cliWorkspaceFiles } from '../src/arw-cli/workspace-files';
import { ipcFetch } from '../src/arw-cli/ipc-client';
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat, open, chmod, unlink, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Subject } from 'rxjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemotePathGuard, isRemotePathInsideRoot } from '../src/security/remote-path'
import { assertCommandAllowed } from '../src/security/command-policy'
import { appendAudit } from '../src/security/audit'
import { ForwardingServer } from '../src/arw-cli/forwarding-server'
import { execGitFixture } from './git-fixture-exec'
import { remoteWorkspace } from '../src/adapters/remote-workspace'

test('trailing-slash terminal roots allow their own directory without weakening boundaries', async () => {
    for (const root of ['/home/share/zhuyuan', '/home/share/zhuyuan/', '/home/share/zhuyuan///']) {
        assert.equal(isRemotePathInsideRoot(root, '/home/share/zhuyuan'), true)
        assert.equal(isRemotePathInsideRoot(root, '/home/share/zhuyuan/'), true)
        assert.equal(isRemotePathInsideRoot(root, '/home/share/zhuyuan/project'), true)
        assert.equal(isRemotePathInsideRoot(root, '/home/share/zhuyuan-other'), false)
        assert.equal(isRemotePathInsideRoot(root, '/home/share/zhuyuan/../other'), false)
        assert.equal(isRemotePathInsideRoot(root, '/home/share'), false)
        assert.doesNotThrow(() => assertCommandAllowed('pwd', root))
        assert.throws(() => assertCommandAllowed('cd ..', root), /denied/)
        const guard = new RemotePathGuard(root, async () => ({stdout: '/home/share/zhuyuan\n/home/share/zhuyuan\n', stderr: '', exitCode: 0}))
        assert.equal(await guard.resolve('.'), '/home/share/zhuyuan')
        await assert.rejects(guard.resolve('../other'), /outside workspaceRoot/)
    }
    assert.equal(isRemotePathInsideRoot('/', '/'), true)
    assert.equal(isRemotePathInsideRoot('/', '/home'), true)
    assert.equal(isRemotePathInsideRoot('/home', 'relative'), false)
})

test('command policy applies high-risk and boundary guards, including nested shells', () => {
    for (const command of ['sudo true', 'rm -rf /', 'mkfs.ext4 /dev/sdb', 'cd /tmp', 'touch ../outside',
        `sh -c 'cd /tmp && touch outside'`, `echo x > "$DESTINATION"`]) {
        assert.throws(() => assertCommandAllowed(command, '/project'), /denied/)
    }
    for (const command of ['git status', 'npm test', 'rm -rf ./dist', 'echo ok > ./result']) assert.doesNotThrow(() => assertCommandAllowed(command, '/project'))
})

test('realpath guard rejects symlink escapes for reads, directories and new writes', {skip: process.platform === 'win32'}, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-path-'))
    t.after(() => rm(directory, {recursive: true, force: true}))
    const root = join(directory, 'root'), outside = join(directory, 'outside')
    await mkdir(root); await mkdir(outside)
    await writeFile(join(outside, 'secret'), 'private')
    await writeFile(join(root, 'file'), 'inside')
    await symlink(outside, join(root, 'escape'))
    await symlink('file', join(root, 'file-link'))
    await symlink('/missing/arw-target', join(root, 'broken'))
    const guard = new RemotePathGuard(root, command => execGitFixture('/bin/sh', ['-c', command]).then(result => ({...result, exitCode: 0}), () => ({stdout: '', stderr: '', exitCode: 1})))
    assert.equal(await guard.resolve('file'), join(root, 'file'))
    assert.equal(await guard.resolve('new-file', true), join(root, 'new-file'))
    assert.equal(await guard.resolve('file-link'), join(root, 'file'))
    for (const [path, write] of [['escape/secret', false], ['escape', false], ['escape/new', true], ['file-link', true], ['broken', true], ['../outside/secret', false], ['file\ninvalid', false]] as const) {
        await assert.rejects(guard.resolve(path, write))
    }
    const unavailable = new RemotePathGuard(root, async () => ({stdout: '', stderr: 'realpath not found', exitCode: 127}))
    await assert.rejects(unavailable.resolve('file'), /Cannot safely resolve/)
    const invalid = new RemotePathGuard(root, async () => ({stdout: 'relative\nrelative\n', stderr: '', exitCode: 0}))
    await assert.rejects(invalid.resolve('file'), /Invalid remote realpath/)
})

test('audit serializes concurrent records, redacts credentials, bounds logs and rejects symlinks', {skip: process.platform === 'win32'}, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-audit-'))
    t.after(() => rm(directory, {recursive: true, force: true}))
    const file = join(directory, 'audit.jsonl')
    const entry = {workspaceId: 'one', operation: 'run_remote_command', outcome: 'denied' as const, requestId: 'request', command: 'sudo TOKEN=secret curl http://host/?token=hidden'}
    await Promise.all(Array.from({length: 12}, () => appendAudit(file, entry)))
    const text = await readFile(file, 'utf8')
    assert.equal(text.trim().split('\n').map(line => JSON.parse(line)).length, 12)
    assert.doesNotMatch(text, /secret|token=hidden/)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await writeFile(file, 'x'.repeat(1024 * 1024))
    await appendAudit(file, entry)
    assert.equal((await stat(`${file}.1`)).size, 1024 * 1024)
    assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 1)
    const link = join(directory, 'link')
    await symlink(file, link)
    await assert.rejects(appendAudit(link, entry), /not a regular file/)
})

test('HTTP forwarding cannot bypass policy and audits requests without content or tokens', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-policy-server-'))
    const audit = join(directory, 'audit.jsonl')
    const executed: string[] = []
    const server = new ForwardingServer({workspace: {id: 'one', root: '/project', host: 'fixture'},
        list: async () => ({}), read: async () => ({}), write: async () => ({}),
        async validateCommand(command) { if (command === 'touch ./link/file') throw new Error('symlink escape') },
        async run(command) { executed.push(command); return {stdout: 'ok', stderr: '', exitCode: 0} },
    }, audit)
    t.after(async () => {await server.stop(); await rm(directory, {recursive: true, force: true})})
    await server.start()
    const request = async (command: string) => (await ipcFetch(server.connection, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'run_remote_command', arguments: {workspaceId: 'one', command}})})).json() as Promise<any>
    for (const command of ['sudo TOKEN=secret true', 'cd /tmp', 'touch ../outside', 'touch ./link/file']) assert.equal((await request(command)).result.status, 'error')
    assert.deepEqual(executed, [])
    assert.equal((await request('git status')).result.stdout, 'ok')
    assert.deepEqual(executed, ['git status'])
    const log = await readFile(audit, 'utf8')
    assert.doesNotMatch(log, /secret|token=/)
    const records = log.trim().split('\n').map(line => JSON.parse(line))
    assert.ok(records.some(record => record.outcome === 'denied'))
    assert.ok(records.some(record => record.outcome === 'completed'))
    assert.equal(records.length, 10)
    const invalidSource = await ipcFetch(server.connection, {method: 'POST', body: JSON.stringify({name: 'run_remote_command', arguments: {workspaceId: 'one', command: 'sudo true', source: 'trusted'}})})
    assert.equal((await invalidSource.json() as any).result.status, 'error')
    assert.deepEqual(executed, ['git status'])
    const blocked = new ForwardingServer({workspace: {id: 'one', root: '/project', host: 'fixture'},
        list: async () => ({}), read: async () => ({}), write: async () => ({}), run: async () => {executed.push('unsafe'); return {}}}, directory)
    await blocked.start()
    try {
        const response = await ipcFetch(blocked.connection, {method: 'POST', body: JSON.stringify({name: 'run_remote_command', arguments: {workspaceId: 'one', command: 'git status'}})})
        assert.equal((await response.json() as any).result.status, 'error')
        assert.deepEqual(executed, ['git status'])
    } finally { await blocked.stop() }
})

test('post-execution audit failure reports unknown mutation state instead of inviting a retry', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-audit-final-'))
    const audit = join(directory, 'audit.jsonl')
    let executions = 0
    const server = new ForwardingServer({workspace: {id: 'one', root: '/project', host: 'fixture'},
        list: async () => ({}), read: async () => ({}), write: async () => ({}), async run() {
            executions++; await rm(audit); await mkdir(audit); return {stdout: 'done', stderr: '', exitCode: 0}
        }}, audit)
    t.after(async () => {await server.stop(); await rm(directory, {recursive: true, force: true})})
    await server.start()
    const response = await ipcFetch(server.connection, {method: 'POST', body: JSON.stringify({name: 'run_remote_command', arguments: {workspaceId: 'one', command: 'git status'}})})
    assert.match((await response.json() as any).result.message, /may have completed.*Do not automatically retry/)
    assert.equal(executions, 1)
})

test('CLI reads may leave the workspace while writes and command forwarding enforce canonical boundaries', {skip: process.platform === 'win32'}, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-adapter-security-'))
    t.after(() => rm(directory, {recursive: true, force: true}))
    const root = join(directory, 'root'), outside = join(directory, 'outside')
    await mkdir(root); await mkdir(outside)
    await writeFile(join(outside, 'secret'), 'private')
    await symlink(outside, join(root, 'escape'))
    const session = {open: true, profile: {options: {host: 'fixture'}},
        ssh: {async openSessionChannel() {
            const data$ = new Subject<Buffer>(), extendedData$ = new Subject<[number, Buffer]>(), closed$ = new Subject<void>()
            let child: ReturnType<typeof spawn>|undefined
            return {data$, extendedData$, closed$, async requestExec(command: string) {
                child = spawn('/bin/sh', ['-c', command])
                child.stdout!.on('data', chunk => data$.next(chunk))
                child.stderr!.on('data', chunk => extendedData$.next([1, chunk]))
                child.on('close', () => closed$.next())
            }, async write(bytes:Uint8Array) {
                await new Promise<void>((resolve,reject)=>child!.stdin!.write(bytes,error=>error?reject(error):resolve()))
            }, async eof() {child?.stdin?.end()}, async close() {child?.kill()}}
        }, async activateChannel(channel: unknown) {return channel}},
        async openSFTP() {return {
            async stat(path: string) {const info = await stat(path); return {size: info.size, mode: info.mode, modified: info.mtime}},
            chmod, unlink,
            async readdir(path: string) {return (await readdir(path, {withFileTypes: true})).map(entry => ({name: entry.name, isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink()}))},
            async open(path: string, flags: number) {
                const handle = await open(path, flags & 1 ? 'r' : 'w')
                let read = false
                return {async read() {if (read) return Buffer.alloc(0); read = true; return handle.readFile()},
                    async write(bytes: Buffer) {await handle.writeFile(bytes)}, async close() {await handle.close()}}
            },
        }},
    }
    const workspace = remoteWorkspace(session as any, `${root}/`)
    const cliFiles = cliWorkspaceFiles(workspace)
    assert.equal((await cliFiles.read('escape/secret')).content,'private')
    assert.equal((await cliFiles.list('escape'))[0].name,'secret')
    await assert.rejects(cliFiles.write('escape/new-file', 'unsafe'), /symbolic link/)
    await assert.rejects(workspace.validateCommand!('touch escape/new-file'), /symbolic link/)
    assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'private')
    await assert.rejects(stat(join(outside, 'new-file')))
    await workspace.write('safe', 'safe-content')
    assert.equal((await workspace.read('safe')).content, 'safe-content')
    assert.ok((await workspace.list('.')).some(entry => entry.name === 'safe'))
    await workspace.validateCommand!('touch safe')
    const server = new ForwardingServer({workspace: {id: 'one', root, host: 'fixture'},
        list: async path => ({entries:await cliFiles.list(path)}), read: async path => cliFiles.read(path),
        write: async (path, content) => cliFiles.write(path, content), run: (command, signal) => workspace.run(command, signal),
        validateCommand: workspace.validateCommand!.bind(workspace)}, join(directory, 'audit.jsonl'))
    await server.start()
    try {
        const response = await ipcFetch(server.connection, {method: 'POST', body: JSON.stringify({name: 'run_remote_command', arguments: {workspaceId: 'one', command: 'touch escape/new-file'}})})
        assert.equal((await response.json() as any).result.status, 'error')
        for(const [name,path] of [['remote_read','escape/secret'],['remote_list','escape'],['remote_write','escape/new-file']]){
            const denied=await ipcFetch(server.connection,{method:'POST',body:JSON.stringify({name,arguments:{workspaceId:'one',path,...(name==='remote_write'?{content:'unsafe'}:{})}})})
            const result=(await denied.json() as any).result
            if(name==='remote_write')assert.equal(result.status,'error')
            else assert.notEqual(result.status,'error',JSON.stringify(result))
        }
        await assert.rejects(stat(join(outside, 'new-file')))
    } finally {await server.stop()}
})
