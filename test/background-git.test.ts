import assert from 'node:assert/strict'
import test from 'node:test'
import {readBackgroundGit} from '../src/arw-tree/git/background-git'
import {localWorkspace} from '../src/arw-tree/workspace'

test('background Git reads bound output and stop stalled backends at the deadline',async()=>{
    let received:AbortSignal|undefined,maxBytes:number|undefined
    const workspace={...localWorkspace('/tmp'),run:async(_command:string,signal?:AbortSignal,options?:{maxBytes?:number})=>{
        received=signal;maxBytes=options?.maxBytes
        return new Promise<never>(()=>{})
    }}
    await assert.rejects(readBackgroundGit(workspace,'git status',undefined,20),/超时/)
    assert.equal(received?.aborted,true)
    assert.equal(maxBytes,256*1024)
})
