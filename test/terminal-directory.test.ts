import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subject } from 'rxjs'
import { changeTerminalDirectory, DirectoryEchoFilter } from '../src/shared/terminal-directory'
import { shellQuote } from '../src/shared/shell-quote'

test('directory filter removes the echoed cd and returns the shell exit status',()=>{
    const marker=Buffer.from('\x1eARW_CD_test:'),echo=Buffer.from('ARW_CD_test')
    const statuses:number[]=[]
    let visible=''
    const filter=new DirectoryEchoFilter(marker,echo,status=>statuses.push(status??-1))
    filter.outputToTerminal$.subscribe(data=>visible+=data.toString())
    filter.feedFromSession(Buffer.from("user$  cd -- /missing; arw_status=$?; printf 'ARW_CD_test:%s'\r\ncd: /missing: No such file\r\n\x1eARW_CD_test:"))
    filter.feedFromSession(Buffer.from('1\x1f'))
    assert.deepEqual(statuses,[1])
    assert.ok(!visible.includes('ARW_CD_test'),visible)
    assert.ok(!visible.includes('cd -- /missing'),visible)
    assert.match(visible,/cd: \/missing: No such file/)
    filter.close()
})

test('workspace switching sends cd despite task or input state and checks its result',async()=>{
    let filter:DirectoryEchoFilter|undefined
    const sent:string[]=[]
    const tab:any={alternateScreenActive:true,sessionChanged$:new Subject(),session:{open:true,closed$:new Subject(),middleware:{
        push:(value:DirectoryEchoFilter)=>{filter=value},remove:()=>{filter=undefined},
    }},sendInput:(text:string)=>{
        sent.push(text)
        const nonce=/ARW_CD_([a-f0-9]+):/.exec(text)?.[1]
        assert.ok(nonce)
        filter!.feedFromSession(Buffer.from(`\x1eARW_CD_${nonce}:0\x1f`))
    }}
    await changeTerminalDirectory(tab,"/project's path")
    assert.equal(sent.length,1)
    assert.ok(sent[0].includes(`cd -- ${shellQuote("/project's path")}`),sent[0])
    assert.match(sent[0],/arw_status=\$\?; printf/)
})

test('a real shell failure is returned as a failed directory change',async t=>{
    const parent=await mkdtemp(join(tmpdir(),'arw-cd-missing-'))
    t.after(()=>rm(parent,{recursive:true,force:true}))
    const shell=spawn('python3',['-c',"import pty; pty.spawn(['/bin/bash','--noprofile','--norc','-i'])"],{env:{...process.env,PS1:'ARW_TEST> ',TERM:'dumb'}})
    t.after(()=>{shell.kill();shell.stdin.destroy();shell.stdout.destroy();shell.stderr.destroy()})
    const closed$=new Subject<void>()
    shell.on('close',()=>closed$.next())
    const session:any={open:true,closed$,middleware:{push:(filter:DirectoryEchoFilter)=>{
        shell.stdout.on('data',(chunk:Buffer)=>filter.feedFromSession(chunk))
        shell.stderr.on('data',(chunk:Buffer)=>filter.feedFromSession(chunk))
    },remove(){}}}
    const tab:any={session,sessionChanged$:new Subject(),alternateScreenActive:false,sendInput:(text:string)=>shell.stdin.write(text)}
    await assert.rejects(changeTerminalDirectory(tab,join(parent,'missing')),/终端路径未同步，仍有未执行输入与任务|Terminal path is not synced/)
})

