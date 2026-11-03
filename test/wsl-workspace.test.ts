import { wslShellArguments } from '../src/shared/wsl-shell'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupLocalGit } from '../src/arw-tree/git/git-bootstrap'
import { workspaceGit } from '../src/arw-tree/git/workspace-git'
import { executeCaptured } from '../src/shared/process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terminalLocalWorkspace, wslCommandPlan } from '../src/adapters/wsl-workspace'
import { shellQuote } from '../src/shared/shell-quote'
import { projectWorkspace } from '../src/arw-tree/workspace'
import { syncLocalGit } from '../src/arw-tree/git/local-git-sync'

const terminal={profile:{type:'local',options:{command:'C:\\Windows\\System32\\wsl.exe',args:['--distribution','Ubuntu','--user=developer','--cd','/old','--exec','bash']}}}

test('WSL command execution preserves distro and user without replaying terminal startup commands',()=>{
    const plan=wslCommandPlan(terminal,"\\\\wsl.localhost\\Ubuntu\\home\\developer's project",'printf hello')
    assert.equal(plan.command,terminal.profile.options.command)
    assert.deepEqual(plan.args.slice(0,-1),['--distribution','Ubuntu','--user','developer','--exec',...wslShellArguments('').slice(0,-1)])
    assert.equal(plan.args.at(-1),`cd -- ${shellQuote("/home/developer's project")} || exit; printf hello`)
    assert.match(wslCommandPlan({profile:{options:{args:[]}}},'\\\\wsl$\\Debian\\home','true').args.join(' '),/--distribution Debian/)
})

test('WSL Git reads, commits and sync use the guest executable and quote host paths and literal values',async()=>{
    const plans:any[]=[]
    const workspace=terminalLocalWorkspace('/tmp/project',terminal,'win32',async(plan,signal)=>{
        plans.push(plan)
        assert.equal(signal,controller.signal)
        return {stdout:'',stderr:'',exitCode:0,truncated:false}
    })
    const controller=new AbortController()
    assert.equal(workspace.executionEnvironment,'wsl')
    assert.equal(projectWorkspace(workspace,'child').executionEnvironment,'wsl')
    await workspace.runGit!(['commit','-m',"C:\\literal $(touch bad) ' message"],controller.signal)
    assert.ok(plans[0].args.at(-1).includes(shellQuote("C:\\literal $(touch bad) ' message")))
    await workspace.runGit!(['-C','C:\\projects\\name with spaces','status'],controller.signal)
    assert.ok(plans[1].args.at(-1).includes(`"$(wslpath -u ${shellQuote('C:\\projects\\name with spaces')})"`))
    await syncLocalGit(workspace.root,'fetch',controller.signal,async(args,signal)=>(await workspace.runGit!(args,signal)).stdout)
    assert.match(plans[2].args.at(-1),/'fetch' '--prune'/)
    controller.abort()
    await assert.rejects(workspace.runGit!(['status'],controller.signal))
    assert.equal(plans.length,3)
})

test('ordinary local terminals retain the native backend',()=>{
    assert.equal(terminalLocalWorkspace('/tmp',{profile:{type:'local',options:{command:'pwsh.exe'}}},'win32').executionEnvironment,undefined)
})

test('repository discovery converts Linux roots through the same WSL distribution and user',async()=>{
    const plans:any[]=[]
    const workspace=terminalLocalWorkspace('/tmp/project',terminal,'win32',async plan=>{
        plans.push(plan)
        return {stdout:plans.length===1?'/home/developer/project\n':'\\\\wsl.localhost\\Ubuntu\\home\\developer\\project\n',stderr:'',exitCode:0,truncated:false}
    })
    assert.equal((await workspace.runGit!(['rev-parse','--show-toplevel'])).stdout,'\\\\wsl.localhost\\Ubuntu\\home\\developer\\project\n')
    assert.deepEqual(plans[0].args.slice(0,-1),plans[1].args.slice(0,-1))
    assert.match(plans[1].args.at(-1),/wslpath -w '\/home\/developer\/project'/)
})


test('WSL setup and commit use the workspace runner end to end', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-wsl-git '))
    context.after(()=>rm(root,{recursive:true,force:true}))
    let calls=0
    const workspace=terminalLocalWorkspace(root,terminal,'win32',async(plan,signal,maxBytes)=>{
        calls++
        assert.equal(plan.command,terminal.profile.options.command)
        return executeCaptured({command:'/bin/sh',args:['-c',plan.args.at(-1)!]},signal,maxBytes)
    })
    await setupLocalGit(workspace,'init',{name:'WSL Test',email:'wsl@example.test',url:'https://example.test/project.git',directory:''})
    const git=workspaceGit(workspace)
    await writeFile(join(root,'file.txt'),'guest commit\n')
    await git.stage(await git.status())
    await git.commit('WSL commit')
    assert.equal((await git.history())[0].subject,'WSL commit')
    assert.ok(calls>5)
})


test('restored WSL UNC roots route Git to the guest even without a WSL source profile',async()=>{
    const {withWslExecution}=await import('../src/adapters/wsl-execution')
    for(const root of ['\\\\wsl.localhost\\Ubuntu-24.04\\root\\project','//wsl.localhost/Ubuntu-24.04/root/project','\\\\wsl$\\Ubuntu-24.04\\root\\project']){
        for(const terminal of [undefined,{profile:{type:'local',options:{command:'powershell.exe'}}}]){
            let plan:any
            const workspace=withWslExecution({root} as any,terminal,'win32',async value=>{
                plan=value
                return {stdout:'',stderr:'',exitCode:0,truncated:false}
            })
            assert.equal(workspace.executionEnvironment,'wsl')
            await workspace.runGit!(['-C',root,'status','--porcelain'])
            assert.equal(plan.command,'wsl.exe')
            assert.deepEqual(plan.args.slice(0,2),['--distribution','Ubuntu-24.04'])
            assert.match(plan.args.at(-1),/^cd -- '\/root\/project'/)
            assert.match(plan.args.at(-1),/git --no-pager/)
            assert.ok(plan.args.at(-1).includes(`\"$(wslpath -u ${shellQuote(root)})\"`))
        }
    }
})
