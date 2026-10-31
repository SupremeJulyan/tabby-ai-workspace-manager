import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localGitRunner } from '../src/arw-tree/git/local-git-push'
import { syncLocalGit } from '../src/arw-tree/git/local-git-sync'
import { readGitSyncState, readCommitSyncHistory } from '../src/arw-tree/git/git-sync-state'
import { RemoteGit } from '../src/arw-tree/git/remote-git'
import { localWorkspace } from '../src/arw-tree/workspace'

test('local synchronization fetches, fast-forwards and pushes only the tracked branch',async context=>{
    const directory=await mkdtemp(join(tmpdir(),'arw-local-sync-'))
    context.after(()=>rm(directory,{recursive:true,force:true}))
    const runner=localGitRunner(),upstream=join(directory,'upstream.git'),first=join(directory,'first'),second=join(directory,'second')
    await runner(['init','--bare',upstream])
    await runner(['init','-b','main',first])
    const run=(root:string,args:string[])=>runner(['-C',root,...args])
    for(const args of [['config','user.name','Test'],['config','user.email','test@example.com']])await run(first,args)
    await writeFile(join(first,'file'),'initial')
    await run(first,['add','.']);await run(first,['commit','-m','initial'])
    await run(first,['remote','add','origin',upstream]);await run(first,['push','-u','origin','main'])
    await runner(['clone','--branch','main',upstream,second])
    for(const args of [['config','user.name','Test'],['config','user.email','test@example.com']])await run(second,args)
    const workspace=localWorkspace(second),git=new RemoteGit(command=>workspace.run(command))
    await writeFile(join(first,'file'),'upstream change')
    await run(first,['commit','-am','upstream change']);await syncLocalGit(first,'push')
    await syncLocalGit(second,'fetch')
    assert.equal((await readGitSyncState(git)).behind,1)
    const incoming=await readCommitSyncHistory(git,await git.history(),await readGitSyncState(git))
    assert.equal(incoming[0].subject,'upstream change')
    assert.equal(incoming[0].syncStatus,'incoming')
    assert.equal(incoming[1].syncStatus,'synced')
    assert.equal(await readFile(join(second,'file'),'utf8'),'initial','fetch does not modify the working tree')
    await syncLocalGit(second,'pull')
    assert.equal(await readFile(join(second,'file'),'utf8'),'upstream change')
    const pulled=new Set([incoming[0].hash])
    assert.equal((await readCommitSyncHistory(git,await git.history(),await readGitSyncState(git),undefined,pulled))[0].syncStatus,'pulled')
    await writeFile(join(second,'local'),'local change')
    await run(second,['add','.']);await run(second,['commit','-m','local change'])
    assert.equal((await readGitSyncState(git)).ahead,1)
    const outgoing=await readCommitSyncHistory(git,await git.history(),await readGitSyncState(git))
    assert.equal(outgoing[0].syncStatus,'unpushed')
    await syncLocalGit(second,'push')
    assert.equal((await readGitSyncState(git)).ahead,0)
    const synchronized=await readCommitSyncHistory(git,await git.history(),await readGitSyncState(git),new Set([outgoing[0].hash]),pulled)
    assert.equal(synchronized[0].syncStatus,'pushed')
    assert.equal(synchronized[1].syncStatus,'pulled')
    assert.equal(synchronized[2].syncStatus,'synced')
    await writeFile(join(first,'other'),'divergent local change')
    await run(first,['add','.']);await run(first,['commit','-m','divergent change'])
    const before=await run(first,['rev-parse','HEAD'])
    const upstreamBefore=await run(upstream,['rev-parse','refs/heads/main'])
    await assert.rejects(syncLocalGit(first,'push'))
    assert.equal(await run(upstream,['rev-parse','refs/heads/main']),upstreamBefore,'divergent pushes never overwrite upstream history')
    await assert.rejects(syncLocalGit(first,'pull'))
    assert.equal(await run(first,['rev-parse','HEAD']),before,'divergent pulls never merge or rewrite history')
    await run(second,['checkout','--detach'])
    await assert.rejects(syncLocalGit(second,'push'),/游离 HEAD/)
    await run(second,['checkout','-b','no-upstream'])
    await assert.rejects(syncLocalGit(second,'pull'),/未配置上游/)
})

test('local push uses an explicit upstream ref and overrides unsafe push defaults',async()=>{
    const calls:string[][]=[]
    await syncLocalGit('/repo','push',undefined,async args=>{
        calls.push(args)
        if(args.includes('symbolic-ref'))return 'feature\n'
        if(args.includes('for-each-ref'))return 'origin\0refs/heads/review\n'
        return ''
    })
    assert.deepEqual(calls.at(-1),['-C','/repo','push','--porcelain','--no-force','--no-mirror','--no-follow-tags','--recurse-submodules=no','--','origin','HEAD:refs/heads/review'])
    await assert.rejects(syncLocalGit('/repo','push',undefined,async()=>{throw new Error('spawn git ENOENT')}),/ENOENT/)
})
