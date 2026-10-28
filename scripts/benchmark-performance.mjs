// Build first. POSIX shell fixtures execute real Git, with a delay per simulated SSH exec.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { Subject } from 'rxjs'

const {values}=parseArgs({options:{'build-dir':{type:'string',default:'.build'},rtt:{type:'string',default:'50'},samples:{type:'string',default:'3'}}})
const build=resolve(values['build-dir']),rtt=Number(values.rtt),samples=Number(values.samples)
if(!Number.isFinite(rtt)||rtt<0||!Number.isInteger(samples)||samples<1||samples>20)throw new Error('Invalid RTT or sample count')
const require=createRequire(import.meta.url)
const {remoteWorkspace}=require(join(build,'adapters/remote-workspace.js'))
const {workspaceGit}=require(join(build,'arw-tree/git/workspace-git.js'))
const {discoverGitRepositories}=require(join(build,'arw-tree/git/git-discovery.js'))
const {readGitSyncState,readCommitSyncHistory}=require(join(build,'arw-tree/git/git-sync-state.js'))
const {readSftpText,saveSftpText}=require(join(build,'adapters/sftp-text.js'))
const root=await mkdtemp(join(tmpdir(),'arw-performance-'))
let requests=0
const session={open:true,profile:{options:{host:'benchmark.invalid'}},willDestroy$:new Subject(),
    ssh:{async openSessionChannel(){requests++;await delay(rtt);return {}},async activateChannel(){
        const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject()
        let child
        return {data$,extendedData$,closed$,async requestExec(command){
            child=spawn('/bin/sh',['-c',command],{cwd:root})
            child.stdout.on('data',bytes=>data$.next(bytes))
            child.stderr.on('data',bytes=>extendedData$.next([1,bytes]))
            child.on('error',error=>closed$.error(error));child.on('close',()=>closed$.next())
        },async eof(){child?.stdin.end()},async close(){child?.kill()}}
    }},async openSFTP(){throw new Error('Shell-only benchmark')},
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
const measure=async operation=>{
    const times=[],counts=[]
    for(let index=0;index<samples;index++){
        requests=0
        const started=performance.now()
        await operation()
        times.push(performance.now()-started);counts.push(requests)
    }
    return {medianMs:Number(median(times).toFixed(1)),execRequests:median(counts)}
}
try{
    const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}})
    for(const args of [['init','-b','main'],['config','user.name','Benchmark'],['config','user.email','benchmark@example.invalid'],
        ['-c','commit.gpgsign=false','commit','--allow-empty','-m','initial'],['config','branch.main.remote','.'],['config','branch.main.merge','refs/heads/main']])git(args)
    const workspace=remoteWorkspace(session,root)
    const discovery=await measure(async()=>{
        const result=await discoverGitRepositories(workspace,{scanNestedRepositories:false})
        assert.deepEqual(result.roots,[root]);assert.equal(result.truncated,false)
    })
    const directory=await measure(async()=>{
        const result=await workspace.listForGit('.',2000)
        assert.ok(result.entries.some(entry=>entry.name==='.git'))
    })
    const inspector=await measure(async()=>{
        const git=workspaceGit(workspace)
        const [branches,commits,state]=await Promise.all([git.branches(),git.history(),readGitSyncState(git)])
        const history=await readCommitSyncHistory(git,commits,state)
        assert.equal(branches[0].name,'main');assert.equal(history[0].syncStatus,'synced')
    })
    const size=32*1024*1024,source=Buffer.alloc(size,120),times=[],memory=[]
    for(let index=0;index<samples;index++){
        globalThis.gc?.()
        const before=process.memoryUsage().external
        let offset=0,peak=before
        const sftp={async stat(){return {size,isDirectory:false,modified:new Date(0)}},async open(){return {
            async read(){peak=Math.max(peak,process.memoryUsage().external);const chunk=source.subarray(offset,offset+256*1024);offset+=chunk.length;return chunk},
            async close(){peak=Math.max(peak,process.memoryUsage().external)},
        }}}
        const started=performance.now(),text=await readSftpText(sftp,'/fixture')
        times.push(performance.now()-started);memory.push((peak-before)/1024/1024)
        assert.equal(text.content.length,size);assert.equal(text.content.charCodeAt(size-1),120)
    }
    const content='x'.repeat(size),saveTimes=[],writeCounts=[],backingSizes=[]
    for(let index=0;index<samples;index++){
        globalThis.gc?.()
        let length=0,writes=0,backing=0
        const sftp={async stat(){return {size:length,isDirectory:false,modified:new Date(0),mode:0o600}},async open(){return {
            async write(bytes){length+=bytes.length;writes++;backing=Math.max(backing,bytes.buffer.byteLength)},async close(){},
        }}}
        const started=performance.now()
        await saveSftpText(sftp,'/fixture',content,undefined,new AbortController().signal,()=>{},()=>{})
        saveTimes.push(performance.now()-started);writeCounts.push(writes);backingSizes.push(backing)
        assert.equal(length,size)
    }
    console.log(JSON.stringify({build,environment:{node:process.version,platform:process.platform,rttMs:rtt,samples,
        transport:'Real local Git and shell commands with simulated SSH exec latency; no live SSH server',gc:!!globalThis.gc},
        repositoryDiscovery:discovery,boundedDirectory:directory,synchronizedGitInspector:inspector,
        sftpRead32MiB:{medianMs:Number(median(times).toFixed(1)),medianExtraExternalMiB:Number(median(memory).toFixed(1))},
        sftpSave32MiB:{medianMs:Number(median(saveTimes).toFixed(1)),writeRequests:median(writeCounts),
            maxBackingBufferKiB:Math.max(...backingSizes)/1024}},null,2))
}finally{await rm(root,{recursive:true,force:true})}
