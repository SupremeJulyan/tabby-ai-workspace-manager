import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorkspaceRecovery, rememberWorkspace, workspaceRecoveryState, restoredWorkspaceProfile } from '../src/shared/workspace-recovery'

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

test('changing workspace requests an immediate snapshot without waiting for the host timer',async()=>{
    const profile={type:'ssh',options:{}}
    const tab={profile,getRecoveryToken:async()=>({profile})}
    const snapshots:Promise<any>[]=[]
    prepareWorkspaceRecovery(tab,()=>{snapshots.push(tab.getRecoveryToken())})
    rememberWorkspace(tab,'/home/user','files')
    rememberWorkspace(tab,'/home/user/project','git')
    assert.equal(snapshots.length,2,'workspace changes save even when no tabs are opened or closed')
    const token=await snapshots.at(-1)
    assert.equal(token.type,'arw-workspace:ssh')
    assert.equal(token.profile.options.arwWorkspace.root,'/home/user/project')
    rememberWorkspace(tab,'/home/user/project','git')
    assert.equal(snapshots.length,2,'unchanged background refresh does not save again')
})

test('legacy host ConfigProxy does not hide saved workspace metadata on restore',()=>{
    const saved={root:'/home/user/project',mode:'files'}
    const options={scripts:[],__getValue:(key:string)=>key==='arwWorkspace'?saved:undefined}
    const profile={type:'ssh',options}
    const tab={profile,getRecoveryToken:async()=>({profile})}
    prepareWorkspaceRecovery(tab)
    assert.equal(workspaceRecoveryState(tab)?.root,saved.root)
    assert.equal((tab.profile.options as any).arwWorkspace.root,saved.root)
    assert.equal((tab.profile.options as any).scripts[0].send," cd -- '/home/user/project'")
})

test('local WSL UNC workspace paths survive recovery without becoming Windows drive paths',async()=>{
    const root='\\\\wsl.localhost\\Ubuntu-24.04\\home\\julyan'
    const profile={type:'local',options:{command:'wsl.exe',arwWorkspace:{root,mode:'files',cwd:root}}}
    const tab={profile,session:{getWorkingDirectory:async()=>root},getRecoveryToken:async()=>({profile:tab.profile})}
    prepareWorkspaceRecovery(tab)
    assert.equal((tab.profile.options as any).cwd,root)
    rememberWorkspace(tab,root+'\\project','files')
    const token=await tab.getRecoveryToken()
    assert.equal((token.profile.options as any).arwWorkspace.root,root+'\\project')
    assert.equal((token.profile.options as any).cwd,root)
})

test('WSL recovery explicitly restores the last shell cwd without changing the browsed root or selecting a distro',()=>{
    const root='\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\project'
    const cwd='\\\\wsl.localhost\\Ubuntu-24.04\\root'
    const profile={type:'local',options:{command:'wsl.exe',args:[],homeDirArgs:['--cd','~'],arwWorkspace:{root,cwd,mode:'files'}}}
    const restored=restoredWorkspaceProfile(profile)
    assert.equal(restored.options.cwd,cwd)
    assert.deepEqual(restored.options.args,['--cd','/root'])
    assert.equal(restored.options.arwWorkspace.root,root)
    assert.deepEqual(restored.options.homeDirArgs,[])
    assert.deepEqual(profile.options.homeDirArgs,['--cd','~'])
    assert.deepEqual(restoredWorkspaceProfile(restored).options.args,['--cd','/root'])
    assert.deepEqual(profile.options.args,[])
})
