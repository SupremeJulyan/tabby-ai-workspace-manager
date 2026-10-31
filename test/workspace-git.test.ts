import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { localWorkspace } from '../src/arw-tree/workspace'
import { workspaceGit } from '../src/arw-tree/git/workspace-git'
import { discoverGitRepositories } from '../src/arw-tree/git/git-discovery'
import { readBackgroundGit } from '../src/arw-tree/git/background-git'

test('native workspace Git handles spaces, Unicode and shell characters without invoking a shell',async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw native git '))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const workspace={...localWorkspace(root),run:async()=>{throw new Error('local Git must not use a shell')}}
    const git=workspaceGit(workspace)
    await git.run(['init','-b','main'])
    await git.run(['config','user.name','ARW Test'])
    await git.run(['config','user.email','arw@example.test'])
    const name="[literal] & ' 名.txt"
    await writeFile(join(root,name),'before\n')
    await git.stage(await git.status())
    await git.commit("message with ' & $ symbols")
    assert.equal((await git.history())[0].subject,"message with ' & $ symbols")
    const values=await git.configMany(['user.name','arw.missing'])
    assert.deepEqual(values,['ARW Test',undefined])
    await writeFile(join(root,name),'after\n')
    const changes=await git.status()
    assert.equal(changes[0].path,name)
    assert.equal(await git.workingChangeCount(),1)
    assert.match(await git.diff(changes[0],false),/\+after/)
    await git.run(['branch','feature'])
    await git.switchBranch('feature')
    assert.equal((await git.branches()).find(branch=>branch.current)?.name,'feature')
    const discovered=await discoverGitRepositories(workspace)
    assert.deepEqual(discovered.roots.map(path=>resolve(path)),[await realpath(root)])
    assert.equal((await readBackgroundGit(workspace,['status','--porcelain=v1','-z'])).exitCode,0)
})

test('native background Git retains cancellation and output limits',async()=>{
    let received:AbortSignal|undefined,maxBytes:number|undefined
    const workspace={...localWorkspace(tmpdir()),runGit:async(_args:string[],signal?:AbortSignal,options?:{maxBytes?:number})=>{
        received=signal;maxBytes=options?.maxBytes;return new Promise<never>(()=>{})
    }}
    await assert.rejects(readBackgroundGit(workspace,['status'],undefined,20),/超时/)
    assert.equal(received?.aborted,true);assert.equal(maxBytes,256*1024)
})
