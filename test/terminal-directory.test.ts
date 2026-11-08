import test from 'node:test'
import assert from 'node:assert/strict'
import { changeTerminalDirectory } from '../src/shared/terminal-directory'
import { shellQuote } from '../src/shared/shell-quote'

for(const [command,root,expected] of [
    ['bash',"/project's path",`cd -- ${shellQuote("/project's path")}\r`],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe',"C:\\Users\\O'Brien", "cd -LiteralPath 'C:\\Users\\O''Brien'\r"],
    ['powershell.exe','C:\\Users\\juyan',"cd -LiteralPath 'C:\\Users\\juyan'\r"],
    ['cmd.exe','D:\\some path','cd /d "D:\\some path"\r'],
]){
    test(`directory switching sends only cd for ${command}`,async()=>{
        const sent:string[]=[]
        const tab:any={profile:{type:'local',options:{command}},session:{open:true},sendInput:(text:string)=>sent.push(text)}
        await changeTerminalDirectory(tab,root)
        assert.deepEqual(sent,[expected])
    })
}

test('directory switching rejects disconnected sessions and multiline paths',async()=>{
    await assert.rejects(changeTerminalDirectory({session:{open:false}} as any,'/project'))
    await assert.rejects(changeTerminalDirectory({session:{open:true},sendInput:()=>assert.fail('must not send')} as any,'/project\npwd'))
})

test('directory commands honor shell hints and remote PowerShell profiles',async()=>{
    for(const type of ['local','ssh']){
        const sent:string[]=[]
        const tab:any={profile:{type,options:{shellType:'powershell'}},session:{open:true},sendInput:(text:string)=>sent.push(text)}
        await changeTerminalDirectory(tab,"C:\\project's [data]")
        assert.deepEqual(sent,["cd -LiteralPath 'C:\\project''s [data]'\r"])
    }
})

test('CMD uses pushd for UNC and rejects variable expansion in directory names',async()=>{
    const sent:string[]=[]
    const tab:any={profile:{type:'local',options:{command:'cmd.exe'}},session:{open:true},sendInput:(text:string)=>sent.push(text)}
    await changeTerminalDirectory(tab,'\\\\server\\share\\project')
    assert.deepEqual(sent,['pushd "\\\\server\\share\\project"\r'])
    for(const path of ['C:\\%TEMP%','C:\\!name!'])await assert.rejects(changeTerminalDirectory(tab,path),/CMD cannot safely/)
    assert.equal(sent.length,1)
})

test('Fish escapes literal backslashes and apostrophes in directory paths',async()=>{
    const sent:string[]=[]
    const tab:any={profile:{type:'ssh',options:{command:'/usr/bin/fish'}},session:{open:true},sendInput:(text:string)=>sent.push(text)}
    await changeTerminalDirectory(tab,"/srv/a\\b's")
    assert.equal(sent[0],"cd -- '/srv/a\\\\b\\'s'\r")
})

test('WSL and Git Bash convert Windows paths in their respective runtimes',async()=>{
    for(const [command,converter] of [['wsl.exe','wslpath'],['C:\\Git\\bin\\bash.exe','cygpath']]){
        const sent:string[]=[]
        const tab:any={profile:{type:'local',options:{command}},session:{open:true},sendInput:(text:string)=>sent.push(text)}
        await changeTerminalDirectory(tab,'D:\\some path')
        assert.equal(sent[0],`cd -- "$(${converter} -u 'D:\\some path')"\r`)
    }
})
