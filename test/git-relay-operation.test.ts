import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitRelayOperation } from '../src/adapters/git-relay-operation'
import { TabbyRelayTransport } from '../src/adapters/transport'
import { gitRelayLocks } from '../src/arw-tree/git/relay-locks'
import type { SSHSession } from '../src/adapters/ssh-compat'

const execute = promisify(execFile)

test('CLI Git relay scopes repositories and shares sidebar locks, releasing SSH references on failure', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arw-relay-operation-'))
    t.after(() => rm(root, {recursive:true,force:true}))
    const repo = join(root,'repo'), nested = join(repo,'nested')
    await mkdir(nested,{recursive:true})
    await execute('git',['init',repo])
    await symlink(tmpdir(),join(repo,'escape'))
    let references = 0, subscriptions = 0
    const session = {
        open:true,
        ref:()=>references++, unref:()=>references--,
        willDestroy$:{subscribe:()=>{subscriptions++;return {unsubscribe:()=>subscriptions--}}},
    } as unknown as SSHSession
    t.mock.method(TabbyRelayTransport.prototype,'run',async function(this:TabbyRelayTransport,command:string,signal?:AbortSignal){
        try {
            const result = await execute('bash',['-c',command],{cwd:this.root,signal})
            return {...result,exitCode:0}
        } catch(error:any) { return {stdout:error.stdout??'',stderr:error.stderr??'',exitCode:error.code??1} }
    })
    const signal = new AbortController().signal
    const operation = gitRelayOperation(session,repo,join(root,'storage'))
    await assert.rejects(operation('pull','..',signal),/outside workspaceRoot/)
    await assert.rejects(operation('push','escape',signal),/escapes workspaceRoot/)
    const locks = new Set([repo]);gitRelayLocks.set(session,locks)
    await assert.rejects(operation('push','nested',signal),/Git/)
    assert.deepEqual([...locks],[repo], 'a rejected contender must preserve the running task lock')
    const scoped = gitRelayOperation(session,nested,join(root,'storage'))
    await assert.rejects(scoped('pull','.',signal),/outside workspaceRoot/)
    assert.equal(references,0)
    assert.equal(subscriptions,0)
    const cancelled = new AbortController();cancelled.abort()
    await assert.rejects(operation('pull','.',cancelled.signal),{name:'AbortError'})
    assert.equal(references,0)
})
