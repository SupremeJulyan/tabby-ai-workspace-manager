import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require=createRequire(import.meta.url)
const {fileRecoveryLogPath,logFileRecovery,flushFileRecoveryLog}=require('../.build/services/file-recovery-log.js')

test('recovery logs are ordered, redacted, private, bounded and tolerate disk errors',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'arw-recovery-log-')),previous=process.env.TABBY_CONFIG_DIRECTORY
    process.env.TABBY_CONFIG_DIRECTORY=directory
    try{
        const file=fileRecoveryLogPath()
        assert.equal(file,join(directory,'omw','file-recovery.jsonl'))
        logFileRecovery('start',{host:'example.test',error:'Authorization: Bearer test-secret-value'})
        logFileRecovery('wait',{rejected:['profile-mismatch']})
        await flushFileRecoveryLog()
        const text=await readFile(file,'utf8'),records=text.trim().split('\n').map(line=>JSON.parse(line))
        assert.deepEqual(records.map(record=>record.event),['start','wait'])
        assert.ok(records.every(record=>record.time&&record.pid===process.pid))
        assert.ok(!text.includes('test-secret-value'))
        if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600)
        await writeFile(file,'x'.repeat(1024*1024))
        logFileRecovery('rotated',{})
        await flushFileRecoveryLog()
        assert.equal((await stat(file+'.1')).size,1024*1024)
        assert.equal(JSON.parse((await readFile(file,'utf8')).trim()).event,'rotated')
        const blocked=join(directory,'blocked');await writeFile(blocked,'not a directory')
        process.env.TABBY_CONFIG_DIRECTORY=blocked
        assert.doesNotThrow(()=>logFileRecovery('disk-failure',{}))
        await assert.doesNotReject(flushFileRecoveryLog())
    }finally{
        if(previous===undefined)delete process.env.TABBY_CONFIG_DIRECTORY
        else process.env.TABBY_CONFIG_DIRECTORY=previous
        await rm(directory,{recursive:true,force:true})
    }
})
