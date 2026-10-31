import test from 'node:test'
import assert from 'node:assert/strict'
import { isWslTerminal, terminalWorkspaceDirectory, resolveTerminalWorkspacePath, terminalWorkspaceDisplayPath } from '../src/shared/wsl-directory.ts'

function terminal(root:string|null,args:string[]=[]){return {profile:{type:'local',options:{command:'C:\\Windows\\System32\\wsl.exe',args}},session:{getWorkingDirectory:async()=>root}}}

test('WSL paths are converted in the selected distribution without shell interpolation',async()=>{
    for(const args of [['-d','Ubuntu'],['--distribution','Ubuntu'],['--distribution=Ubuntu']]){
        const root="/home/user/a 'quoted' $(command)"
        const result=await terminalWorkspaceDirectory(terminal(root,args),'win32',async invocation=>{
            assert.deepEqual(invocation,['--distribution','Ubuntu','--exec','wslpath','-w',root])
            return '\\\\wsl.localhost\\Ubuntu\\home\\user\\project\r\n'
        })
        assert.equal(result,'\\\\wsl.localhost\\Ubuntu\\home\\user\\project')
    }
})
test('default distribution and mounted drives use wslpath',async()=>{
    assert.equal(await terminalWorkspaceDirectory(terminal('/mnt/d/project'),'win32',async args=>{
        assert.deepEqual(args,['--exec','wslpath','-w','/mnt/d/project']);return 'D:\\project\n'
    }),'D:\\project')
})
test('native terminals and missing reports do not invoke WSL',async()=>{
    const unexpected=async()=>{throw new Error('unexpected conversion')}
    assert.equal(await terminalWorkspaceDirectory(terminal(null),'win32',unexpected),undefined)
    assert.equal(await terminalWorkspaceDirectory(terminal('D:\\project'),'win32',unexpected),undefined)
    assert.equal(await terminalWorkspaceDirectory(terminal('/home/user'),'linux',unexpected),'/home/user')
    assert.equal(isWslTerminal({profile:{type:'ssh',options:{command:'wsl'}}}),false)
})
test('invalid conversion output is rejected',async()=>{
    await assert.rejects(terminalWorkspaceDirectory(terminal('/home/user'),'win32',async()=>'/home/user\n'),/Invalid Windows/)
})
test('unchanged reports reuse conversion and failed conversions can retry',async()=>{
    const tab=terminal('/home/user')
    let calls=0
    const convert=async()=>{calls++;if(calls===1)throw new Error('temporarily unavailable');return '\\\\wsl.localhost\\Ubuntu\\home\\user\n'}
    await assert.rejects(terminalWorkspaceDirectory(tab,'win32',convert),/temporarily unavailable/)
    await terminalWorkspaceDirectory(tab,'win32',convert)
    await terminalWorkspaceDirectory(tab,'win32',convert)
    assert.equal(calls,2)
})

test('manual WSL absolute paths resolve to UNC or mounted Windows drives',async()=>{
    const tab=terminal(null)
    assert.equal(await resolveTerminalWorkspacePath(tab,'/root','win32',async args=>{
        assert.deepEqual(args,['--exec','wslpath','-w','/root'])
        return '\\\\wsl.localhost\\Ubuntu-24.04\\root\n'
    }),'\\\\wsl.localhost\\Ubuntu-24.04\\root')
    assert.equal(await resolveTerminalWorkspacePath(tab,'/mnt/d/projects','win32',async()=> 'D:\\projects\n'),'D:\\projects')
})
test('WSL host-side guesses never masquerade as reported Linux directories',async()=>{
    const unexpected=async()=>{throw new Error('should request an OSC report first')}
    for(const path of ['C:\\Users\\user\\Pictures','\\\\wsl.localhost\\Ubuntu-24.04\\home']){
        assert.equal(await terminalWorkspaceDirectory(terminal(path),'win32',unexpected),undefined)
    }
    const native={profile:{type:'local',options:{command:'pwsh.exe'}},session:{getWorkingDirectory:async()=> 'C:\\Users\\user'}}
    assert.equal(await terminalWorkspaceDirectory(native,'win32',unexpected),'C:\\Users\\user')
})

test('WSL UI converts host drive paths back to native paths and strips UNC prefixes',async()=>{
    const tab=terminal(null)
    assert.equal(await terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async args=>{
        assert.deepEqual(args,['--exec','wslpath','-u','D:\\projects'])
        return '/mnt/d/projects\n'
    }),'/mnt/d/projects')
    assert.equal(await terminalWorkspaceDisplayPath(tab,'\\\\wsl.localhost\\Ubuntu-24.04\\root','win32',async()=>{throw new Error('UNC paths need no subprocess')}),'/root')
})
test('native paths survive backend conversion and UI display with custom WSL mounts',async()=>{
    const tab=terminal(null)
    const windows=await resolveTerminalWorkspacePath(tab,'/drives/d/projects','win32',async()=> 'D:\\projects\n')
    const native=await terminalWorkspaceDisplayPath(tab,windows,'win32',async()=>{throw new Error('reported native path should be reused')})
    assert.equal(native,'/drives/d/projects')
    assert.equal(await resolveTerminalWorkspacePath(tab,native,'win32',async()=>{throw new Error('cached backend path should be reused')}),windows)
})
test('invalid native display paths are rejected and can retry',async()=>{
    const tab=terminal(null)
    await assert.rejects(terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async()=> 'relative\n'),/Invalid Linux path/)
    assert.equal(await terminalWorkspaceDisplayPath(tab,'D:\\projects','win32',async()=> '/mnt/d/projects\n'),'/mnt/d/projects')
})
