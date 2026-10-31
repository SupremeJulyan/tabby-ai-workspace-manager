import test from 'node:test'
import assert from 'node:assert/strict'
import { isWslTerminal, terminalWorkspaceDirectory } from '../src/shared/wsl-directory.ts'

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
    assert.equal(await terminalWorkspaceDirectory(terminal('D:\\project'),'win32',unexpected),'D:\\project')
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
