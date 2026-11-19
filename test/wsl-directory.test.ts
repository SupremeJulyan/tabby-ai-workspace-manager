import test from 'node:test'
import assert from 'node:assert/strict'
import { isWslTerminal, wslHomeDirectory, resolveTerminalWorkspacePath, terminalWorkspaceDisplayPath } from '../src/shared/wsl-directory.ts'

function terminal(args:string[]=[]){return {profile:{type:'local',options:{command:'C:\\Windows\\System32\\wsl.exe',args}}}}

test('WSL home uses configured distro and user, never interactive terminal cwd',async()=>{
    const home=await wslHomeDirectory(terminal(['-d','Ubuntu','-u','alice']),'win32',async args=>{
        if(args.includes('wslpath')){
            assert.deepEqual(args,['--distribution','Ubuntu','--exec','wslpath','-w','/home/alice'])
            return '\\\\wsl.localhost\\Ubuntu\\home\\alice\r\n'
        }
        assert.deepEqual(args,['-d','Ubuntu','-u','alice','--exec','sh','-lc','printf %s "$HOME"'])
        return '/home/alice\r\n'
    })
    assert.equal(home,'\\\\wsl.localhost\\Ubuntu\\home\\alice')
})
test('native terminals do not query WSL home',async()=>{
    const unexpected=async()=>{throw new Error('unexpected conversion')}
    assert.equal(await wslHomeDirectory({profile:{type:'local',options:{command:'pwsh.exe'}}},'win32',unexpected),undefined)
    assert.equal(isWslTerminal({profile:{type:'ssh',options:{command:'wsl'}}}),false)
})

test('manual WSL absolute paths resolve to UNC or mounted Windows drives',async()=>{
    const tab=terminal()
    assert.equal(await resolveTerminalWorkspacePath(tab,'/root','win32',async args=>{
        assert.deepEqual(args,['--exec','wslpath','-w','/root'])
        return '\\\\wsl.localhost\\Ubuntu-24.04\\root\n'
    }),'\\\\wsl.localhost\\Ubuntu-24.04\\root')
    assert.equal(await resolveTerminalWorkspacePath(tab,'/mnt/d/projects','win32',async()=> 'D:\\projects\n'),'D:\\projects')
})
test('WSL host-side guesses never masquerade as reported Linux directories',async()=>{
    assert.equal(await wslHomeDirectory(terminal(),'linux',async()=>'/home/user'),undefined)
})

test('WSL UI converts host drive paths back to native paths and strips UNC prefixes',async()=>{
    const tab=terminal()
    assert.equal(await terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async args=>{
        assert.deepEqual(args,['--exec','wslpath','-u','D:\\projects'])
        return '/mnt/d/projects\n'
    }),'/mnt/d/projects')
    assert.equal(await terminalWorkspaceDisplayPath(tab,'\\\\wsl.localhost\\Ubuntu-24.04\\root','win32',async()=>{throw new Error('UNC paths need no subprocess')}),'/root')
})
test('native paths survive backend conversion and UI display with custom WSL mounts',async()=>{
    const tab=terminal()
    const windows=await resolveTerminalWorkspacePath(tab,'/drives/d/projects','win32',async()=> 'D:\\projects\n')
    const native=await terminalWorkspaceDisplayPath(tab,windows,'win32',async()=>{throw new Error('reported native path should be reused')})
    assert.equal(native,'/drives/d/projects')
    assert.equal(await resolveTerminalWorkspacePath(tab,native,'win32',async()=>{throw new Error('cached backend path should be reused')}),windows)
})
test('invalid native display paths are rejected and can retry',async()=>{
    const tab=terminal()
    await assert.rejects(terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async()=> 'relative\n'),/Invalid Linux path/)
    assert.equal(await terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async()=> '/mnt/d/projects\n'),'/mnt/d/projects')
})
