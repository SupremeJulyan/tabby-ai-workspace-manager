import { ipcFetch } from '../src/arw-cli/ipc-client';
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentActivityStore, agentActivity, activityScope } from '../src/arw-cli/agent-activity'
import { ForwardingServer } from '../src/arw-cli/forwarding-server'

const workspace = {id:'activity-fixture', root:'/project', host:'fixture'}

test('activity tracks concurrent requests, durations, failures, and redacts metadata only', () => {
    let now = 100
    const store = new AgentActivityStore(200, () => now)
    let updates = 0
    const unsubscribe = store.subscribe(() => { updates++ })
    store.subscribe(() => { throw new Error('UI must not break execution') })
    const first = store.start(workspace, {name:'run_remote_command', arguments:{command:'echo --token secret', content:'file body'}})
    const second = store.start(workspace, {name:'remote_write', arguments:{path:'/project/test', content:'private body'}})
    now = 150
    store.finish(second, {content:'private response'})
    store.finish(first, {exitCode:2, stdout:'private stdout'})
    const events = store.snapshot()
    assert.equal(events[0].category, 'write')
    assert.equal(events[0].status, 'success')
    assert.equal(events[1].status, 'error')
    assert.equal(events[1].exitCode, 2)
    assert.equal(events[1].durationMs, 50)
    assert.doesNotMatch(JSON.stringify(events), /secret|private|file body/)
    events[0].status = 'denied'
    assert.equal(store.snapshot()[0].status, 'success')
    unsubscribe()
    const count = updates
    store.clear()
    assert.equal(updates, count)
    assert.deepEqual(store.snapshot(), [])
})

test('activity history is bounded and clearing preserves running requests', () => {
    const store = new AgentActivityStore(2)
    const removed = store.start(workspace, {name:'remote_read'})
    const completed = store.start(workspace, {name:'remote_list'})
    const running = store.start(workspace, {name:'run_remote_command'})
    store.finish(removed)
    store.finish(completed)
    assert.equal(store.snapshot().length, 2)
    store.clear()
    assert.deepEqual(store.snapshot().map(event => event.id), [running])
    store.finish(running, undefined, new Error('TOKEN=private'), true)
    assert.equal(store.snapshot()[0].status, 'denied')
    assert.doesNotMatch(store.snapshot()[0].error!, /private/)
})

test('real forwarding populates activities without replacing or clearing security audit', async context => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-activity-'))
    const audit = join(directory, 'audit.jsonl')
    const server = new ForwardingServer({workspace, activityScope:'forwarding-fixture', list:async()=>({}), read:async()=>({}), write:async()=>({}), run:async()=>({exitCode:7, stdout:'never displayed'})}, audit)
    context.after(async()=>{ await server.stop(); await rm(directory,{recursive:true,force:true}) })
    await server.start()
    const request = async(command:string) => {
        const response = await ipcFetch(server.connection, {method:'POST', body:JSON.stringify({name:'run_remote_command', arguments:{workspaceId:workspace.id, command}})})
        return response.json() as Promise<any>
    }
    await request('git status')
    assert.equal(agentActivity.snapshot()[0].status, 'error')
    assert.equal(agentActivity.snapshot()[0].exitCode, 7)
    assert.equal(agentActivity.snapshot('forwarding-fixture')[0].exitCode,7)
    assert.deepEqual(agentActivity.snapshot('another-terminal'),[])
    assert.equal((await request('sudo true')).result.code, 'POLICY_DENIED')
    assert.equal(agentActivity.snapshot()[0].status, 'denied')
    const before = await readFile(audit, 'utf8')
    agentActivity.clear()
    assert.equal(await readFile(audit, 'utf8'), before)
    assert.match(before, /"outcome":"denied"/)
})


test('remote terminals isolate history and clearing even on the same host and workspace', () => {
    const first={}, second={}
    const a=activityScope(first), b=activityScope(second)
    assert.equal(activityScope(first),a)
    assert.notEqual(a,b)
    const store=new AgentActivityStore()
    const one=store.start(workspace,{name:'remote_read'},a)
    const two=store.start(workspace,{name:'remote_read'},b)
    const running=store.start(workspace,{name:'run_remote_command'},a)
    store.finish(one);store.finish(two)
    assert.deepEqual(store.snapshot(a).map(event=>event.id),[running,one])
    assert.deepEqual(store.snapshot(b).map(event=>event.id),[two])
    store.clear(a)
    assert.deepEqual(store.snapshot(a).map(event=>event.id),[running])
    assert.deepEqual(store.snapshot(b).map(event=>event.id),[two])
})
