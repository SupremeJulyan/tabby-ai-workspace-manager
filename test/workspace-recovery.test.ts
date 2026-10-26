import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorkspaceRecovery, rememberWorkspace, workspaceRecoveryState } from '../src/shared/workspace-recovery'

test('SSH recovery preserves each tab workspace and cwd without changing the saved profile',async()=>{
    const profile={type:'ssh',options:{host:'server',scripts:[{expect:'',send:'export TEST=1'}]}}
    const tab={profile,session:{getWorkingDirectory:async()=>'/srv/shell'},getRecoveryToken:async()=>({type:'app:ssh-tab',profile})}
    prepareWorkspaceRecovery(tab)
    rememberWorkspace(tab,"/srv/project's folder",'git')
    const token=await tab.getRecoveryToken()
    assert.equal(profile.options.scripts.length,1)
    assert.equal((profile.options as any).arwWorkspace,undefined)
    const restored={profile:(token as any).profile,getRecoveryToken:async()=>token}
    prepareWorkspaceRecovery(restored)
    assert.deepEqual(workspaceRecoveryState(restored),{root:"/srv/project's folder",mode:'git',cwd:'/srv/shell'})
    assert.equal(restored.profile.options.scripts.at(-1).send," cd -- '/srv/shell'")
    assert.equal((await restored.getRecoveryToken()).profile.options.scripts.length,1,'repeated restarts must not accumulate cd commands')
})

test('remote cwd falls back to the open workspace when the shell cannot report cwd',async()=>{
    const profile={type:'ssh',options:{arwWorkspace:{root:'/srv/a\\b',mode:'files'}}}
    const tab={profile,getRecoveryToken:async()=>({profile:tab.profile})}
    prepareWorkspaceRecovery(tab)
    assert.equal((tab.profile.options as any).scripts[0].send," cd -- '/srv/a\\\\b'")
})

test('local recovery uses the terminal cwd and leaves AI recovery untouched',async()=>{
    const profile={type:'local',options:{cwd:'/old'}}
    const tab={profile,session:{getWorkingDirectory:async()=>'/current'},getRecoveryToken:async()=>({profile})}
    prepareWorkspaceRecovery(tab);rememberWorkspace(tab,'/browser','files')
    assert.equal((await tab.getRecoveryToken()).profile.options.cwd,'/current')
    assert.equal(profile.options.cwd,'/old')
    const ai={profile:{type:'local',options:{env:{ARW_WORKSPACE_ROOT:'/project'}}},getRecoveryToken:async()=>({profile:{}})}
    const original=ai.getRecoveryToken;prepareWorkspaceRecovery(ai)
    assert.equal(ai.getRecoveryToken,original)
})
