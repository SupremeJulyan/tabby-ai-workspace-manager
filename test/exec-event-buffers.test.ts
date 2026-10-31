import {test} from 'node:test'
import * as assert from 'node:assert/strict'
import {ClientEventInterface} from 'russh/lib/events'
import {retainExecEventBuffers} from '../src/adapters/exec-event-buffers'
import {executeChannel,type ExecChannel} from '../src/shared/exec-channel'

function fixture(protectedChannel:boolean){
    const events=new ClientEventInterface(),id=47
    let requests=0
    const original=events.data$.closeChannel
    const channel:ExecChannel&{id:number}={id,data$:events.data$.subscribe(id),extendedData$:events.extendedData$.subscribe(id),closed$:events.close$.subscribe(id),
        requestExec:async script=>{
            requests++
            const marker=/ARW_EXIT_[a-f0-9]+/.exec(script)![0]
            events.closeCallback(null,id)
            setTimeout(()=>events.dataCallback(null,id,Buffer.from(`late output\0${marker}:7\0`)),20)
            setTimeout(()=>events.extendedDataCallback(null,id,1,Buffer.from(`late stderr\0${marker}:stderr\0`)),40)
        },eof:async()=>{},close:async()=>{}}
    const release=protectedChannel?retainExecEventBuffers({events},channel):()=>{}
    return {events,channel,release,original,requests:()=>requests}
}

test('real russh buffers reproduce output loss when close precedes data',async()=>{
    const f=fixture(false)
    await assert.rejects(executeChannel(f.channel,'true','/tmp'),/状态未知.*stdout=0 B, stderr=0 B/)
    assert.equal(f.requests(),1)
})

test('retained exec buffers deliver late stdout and stderr without executing twice',async()=>{
    const f=fixture(true)
    try{
        const result=await executeChannel(f.channel,'true','/tmp')
        assert.deepEqual(result,{stdout:'late output',stderr:'late stderr',exitCode:7})
        assert.equal(f.requests(),1)
    }finally{f.release();f.release()}
    assert.equal(f.events.data$.closeChannel,f.original)
})

test('concurrent exec guards restore cleanup independently and leave terminal channels untouched',()=>{
    const events=new ClientEventInterface(),original=events.data$.closeChannel
    const first=retainExecEventBuffers({events},{id:1}),second=retainExecEventBuffers({events},{id:2})
    const outputs=[0,0,0]
    const subscriptions=[1,2,3].map((id,index)=>events.data$.subscribe(id).subscribe(()=>outputs[index]++))
    for(const id of [1,2,3])events.closeCallback(null,id)
    for(const id of [1,2,3])events.dataCallback(null,id,Buffer.from('x'))
    assert.deepEqual(outputs,[1,1,0])
    first();assert.notEqual(events.data$.closeChannel,original)
    events.dataCallback(null,2,Buffer.from('x'));assert.equal(outputs[1],2)
    second();assert.equal(events.data$.closeChannel,original)
    for(const subscription of subscriptions)subscription.unsubscribe()
})

test('stdout completion alone never masks a missing stderr tail',async()=>{
    const events=new ClientEventInterface(),id=8
    const channel:ExecChannel={data$:events.data$.subscribe(id),extendedData$:events.extendedData$.subscribe(id),closed$:events.close$.subscribe(id),
        requestExec:async script=>{
            const marker=/ARW_EXIT_[a-f0-9]+/.exec(script)![0]
            events.dataCallback(null,id,Buffer.from(`complete\0${marker}:0\0`))
            events.closeCallback(null,id)
        },eof:async()=>{},close:async()=>{}}
    const release=retainExecEventBuffers({events},{id})
    try{await assert.rejects(executeChannel(channel,'true','/tmp'),/状态未知/)}finally{release()}
})
