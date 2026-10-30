import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subject } from 'rxjs'
import { changeTerminalDirectory, DirectoryEchoFilter } from '../src/shared/terminal-directory'

test('directory echo filter handles split markers and preserves errors and subsequent output',()=>{
    let acknowledged=0,visible=''
    const filter=new DirectoryEchoFilter(Buffer.from('\x1eDONE\x1f'),()=>acknowledged++)
    filter.outputToTerminal$.subscribe(data=>visible+=data.toString())
    filter.feedFromSession(Buffer.from(" cd -- '/some/path'\r\n\x1eDO"))
    assert.equal(visible,'')
    filter.feedFromSession(Buffer.from('NE\x1fcd: missing directory\r\n'))
    filter.feedFromSession(Buffer.from('new prompt> manual command\r\n'))
    assert.equal(acknowledged,1)
    assert.equal(visible,'\r\x1b[2Kcd: missing directory\r\nnew prompt> manual command\r\n')
    filter.close()
})

test('directory switch changes a real Bash cwd without displaying the injected command',async t=>{
    const root=await mkdtemp(join(tmpdir(),"arw cd 'quoted'-"))
    t.after(()=>rm(root,{recursive:true,force:true}))
    const shell=spawn('python3',['-c',"import pty; pty.spawn(['/bin/bash','--noprofile','--norc','-i'])"],{env:{...process.env,PS1:'ARW_TEST> ',TERM:'dumb'}})
    t.after(()=>{shell.kill();shell.stdin.destroy();shell.stdout.destroy();shell.stderr.destroy()})
    let filter:DirectoryEchoFilter|undefined,visible=''
    const closed$=new Subject<void>()
    shell.on('close',()=>closed$.next())
    let ready!:()=>void
    const prompt=new Promise<void>(resolve=>ready=resolve)
    const feed=(chunk:Buffer)=>{
        if(filter)filter.feedFromSession(chunk)
        else visible+=chunk.toString()
        if(visible.includes('ARW_TEST> '))ready()
    }
    shell.stdout.on('data',feed);shell.stderr.on('data',feed)
    await prompt
    const tab:any={alternateScreenActive:false,sessionChanged$:new Subject(),sendInput:(text:string)=>shell.stdin.write(text),session:{open:true,closed$,middleware:{
        push:(next:DirectoryEchoFilter)=>{filter=next;next.outputToTerminal$.subscribe(data=>visible+=data.toString())},
        remove:()=>{filter=undefined},
    }}}
    visible=''
    await changeTerminalDirectory(tab,root)
    shell.stdin.write("printf 'CWD=%s\\n' \"$PWD\"\r")
    await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error(visible))},3000)
        const poll=setInterval(()=>{if(visible.includes(`CWD=${root}`)){clearTimeout(timeout);clearInterval(poll);resolve()}},10)
    })
    assert.ok(!visible.includes('cd --'),visible)
    assert.ok(!visible.includes('ARW_CD_'),visible)
    assert.ok(visible.includes(`CWD=${root}`),visible)
})


test('directory switch distinguishes disconnected sessions from full-screen applications without sending commands',async()=>{
    const sent:string[]=[]
    const tab:any={session:null,alternateScreenActive:false,sendInput:(text:string)=>sent.push(text)}
    await assert.rejects(changeTerminalDirectory(tab,'/project'),/not connected|终端尚未连接/)
    tab.session={open:false}
    await assert.rejects(changeTerminalDirectory(tab,'/project'),/not connected|终端尚未连接/)
    tab.session.open=true;tab.alternateScreenActive=true
    await assert.rejects(changeTerminalDirectory(tab,'/project'),/full-screen|全屏程序/)
    assert.deepEqual(sent,[])
})
