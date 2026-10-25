import assert from 'node:assert/strict'
import test from 'node:test'
import { Subject } from 'rxjs'
import { SaveConfirmation, SaveConfirmationState } from '../src/adapters/save-confirmation'

const fixture=(timeout=25)=>{
    const disconnected=new Subject<void>()
    const saves=new SaveConfirmation(listener=>disconnected.subscribe(listener),()=>true,timeout)
    return {disconnected,saves}
}
const deferred=()=>{
    let resolve!:()=>void
    const promise=new Promise<void>(done=>{resolve=done})
    return {promise,resolve}
}

test('confirmed saves remove their record and disconnect listener',async()=>{
    const {saves,disconnected}=fixture()
    assert.equal(await saves.run('file','new',async(_signal,permissions)=>{permissions('640:1:2');return 'saved'}),'saved')
    assert.equal(saves.issue('file'),undefined)
    assert.equal(disconnected.observed,false)
    await saves.run('file','next',async()=>undefined)
})

test('timeout marks the file, locks pending writes and does not accept late success',async()=>{
    const {saves,disconnected}=fixture(),blocked=deferred()
    let signal!:AbortSignal
    const pending=saves.run('file','new',async(current,permissions)=>{signal=current;permissions('640:1:2');await blocked.promise})
    await assert.rejects(pending,/超时/)
    assert.equal(signal.aborted,true)
    assert.equal(saves.issue('file')?.busy,true)
    await assert.rejects(saves.run('file','again',async()=>undefined),/尚未确认/)
    await assert.rejects(saves.run('file','again',async()=>undefined,true),/尚未确认/)
    await assert.rejects(saves.verify('file',async()=>({content:'new',permissions:'640:1:2'})),/仍未结束/)
    await assert.rejects(saves.reload('file',async()=>''),/仍未结束/)
    assert.equal(disconnected.observed,false)
    blocked.resolve();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(saves.issue('file')?.busy,false)
    assert.match(saves.issue('file')!.message,/超时/)
    await saves.verify('file',async()=>({content:'new',permissions:'640:1:2'}))
    assert.equal(saves.issue('file'),undefined)
})

test('disconnect aborts the active save without marking unrelated files',async()=>{
    const {saves,disconnected}=fixture(1000),blocked=deferred()
    let signal!:AbortSignal
    const pending=saves.run('file','new',async current=>{signal=current;await blocked.promise;current.throwIfAborted()})
    await new Promise(resolve=>setImmediate(resolve))
    disconnected.next()
    await assert.rejects(pending,/断开/)
    assert.equal(signal.aborted,true)
    assert.equal(saves.issue('other'),undefined)
    blocked.resolve();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(saves.issue('file')?.busy,false)
    assert.equal(disconnected.observed,false)
})

test('a previously disconnected session never starts the write',async()=>{
    let writes=0
    const saves=new SaveConfirmation(()=>({unsubscribe(){}}),()=>false)
    await assert.rejects(saves.run('file','new',async()=>{writes++}),/断开/)
    assert.equal(writes,0)
})

test('verification retains warnings for mismatched contents or permissions and read failures',async()=>{
    const {saves}=fixture()
    await assert.rejects(saves.run('file','new',async(_signal,permissions,started)=>{permissions('640:1:2');started();throw new Error('lost acknowledgement')}))
    for(const current of [{content:'old',permissions:'640:1:2'},{content:'new',permissions:'600:1:2'},{content:'new',permissions:'640:2:2'}]){
        await assert.rejects(saves.verify('file',async()=>current),/不一致/)
        assert.ok(saves.issue('file'))
    }
    await assert.rejects(saves.verify('file',async()=>{throw new Error('unreadable')}),/unreadable/)
    assert.ok(saves.issue('file'))
    await saves.verify('file',async()=>({content:'new',permissions:'640:1:2'}))
    assert.equal(saves.issue('file'),undefined)
})

test('verification and reload have deadlines and late reads cannot clear warnings',async()=>{
    const {saves}=fixture(),blocked=deferred()
    await assert.rejects(saves.run('file','new',async(_signal,permissions,started)=>{permissions('640:1:2');started();throw new Error('failed')}))
    await assert.rejects(saves.verify('file',async()=>{await blocked.promise;return {content:'new',permissions:'640:1:2'}}),/超时/)
    await assert.rejects(saves.reload('file',async()=>{await blocked.promise;return 'remote'}),/超时/)
    blocked.resolve();await new Promise(resolve=>setImmediate(resolve))
    assert.ok(saves.issue('file'))
    assert.equal(await saves.reload('file',async()=>'remote'),'remote')
    assert.equal(saves.issue('file'),undefined)
})

test('missing pre-save permissions requires explicit reload, not a content-only confirmation',async()=>{
    const {saves}=fixture()
    await assert.rejects(saves.run('file','new',async(_signal,_permissions,started)=>{started();throw new Error('write failed')}))
    await assert.rejects(saves.verify('file',async()=>({content:'new',permissions:'640:1:2'})),/权限记录/)
    await assert.rejects(saves.reload('file',async()=>{throw new Error('read failed')}),/read failed/)
    assert.ok(saves.issue('file'))
    await saves.reload('file',async()=>'remote')
    await saves.run('file','next',async()=>undefined)
})

test('preflight conflict failures do not mark a file that was never written',async()=>{
    const {saves}=fixture()
    await assert.rejects(saves.run('file','new',async()=>{throw new Error('content conflict')}),/content conflict/)
    assert.equal(saves.issue('file'),undefined)
    await saves.run('file','retry',async()=>undefined)
})

test('replacement SSH sessions share warnings but subscribe only to their own disconnect event',async()=>{
    const state=new SaveConfirmationState(),oldDisconnected=new Subject<void>(),newDisconnected=new Subject<void>()
    const oldSession=new SaveConfirmation(listener=>oldDisconnected.subscribe(listener),()=>true,1000,state)
    const replacement=new SaveConfirmation(listener=>newDisconnected.subscribe(listener),()=>true,1000,state)
    await assert.rejects(oldSession.run('file','new',async(_signal,permissions,started)=>{permissions('640:1:2');started();throw new Error('disconnected')}))
    assert.ok(replacement.issue('file'))
    await assert.rejects(replacement.run('file','retry',async()=>undefined),/尚未确认/)
    await replacement.verify('file',async()=>({content:'new',permissions:'640:1:2'}))
    assert.equal(oldSession.issue('file'),undefined)
    await replacement.run('file','next',async()=>{
        assert.equal(oldDisconnected.observed,false)
        assert.equal(newDisconnected.observed,true)
        oldDisconnected.next()
    })
    assert.equal(newDisconnected.observed,false)
})

test('confirmed retries retain warnings on preflight failure and clear them only after successful writing',async()=>{
    const {saves}=fixture()
    await assert.rejects(saves.run('file','attempted',async(_signal,permissions,started)=>{permissions('640:1:2');started();throw new Error('write failed')}))
    const original=saves.issue('file')
    await assert.rejects(saves.run('file','retry',async()=>{throw new Error('permission denied')},true),/permission denied/)
    assert.deepEqual(saves.issue('file'),original)
    await assert.rejects(saves.verify('file',async()=>({content:'retry',permissions:'640:1:2'})),/不一致/)
    await saves.run('file','retry',async(_signal,permissions,started)=>{
        assert.ok(saves.issue('file'))
        permissions('600:1:2');started()
    },true)
    assert.equal(saves.issue('file'),undefined)
})
