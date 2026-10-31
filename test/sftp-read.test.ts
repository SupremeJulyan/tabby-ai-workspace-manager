import assert from 'node:assert/strict'
import test from 'node:test'
import { readSftpBytes } from '../src/adapters/sftp-read'

test('SFTP reads own their bytes even when the transport reuses its chunk buffer',async()=>{
    const buffer=new Uint8Array(3)
    let reads=0
    const file={async read(){
        reads++
        if(reads===3)return new Uint8Array()
        buffer.fill(reads)
        return buffer
    }}
    assert.deepEqual([...await readSftpBytes(file,6)],[1,1,1,2,2,2])
    assert.equal(reads,3,'EOF is checked after the advertised size')
})

test('SFTP reads reject growth, shrinkage and cancellation instead of returning partial bytes',async()=>{
    await assert.rejects(readSftpBytes({read:async()=>new Uint8Array(4)},3),/发生变化/)
    await assert.rejects(readSftpBytes({read:async()=>new Uint8Array()},3),/发生变化/)
    assert.equal((await readSftpBytes({read:async()=>new Uint8Array()},0)).length,0)
    const controller=new AbortController()
    let reads=0
    const file={async read(){reads++;controller.abort(new Error('closed tab'));return new Uint8Array(3)}}
    await assert.rejects(readSftpBytes(file,3,controller.signal),/closed tab/)
    assert.equal(reads,1)
    await assert.rejects(readSftpBytes(file,3,controller.signal),/closed tab/)
    assert.equal(reads,1,'already cancelled requests never reach SFTP')
})
