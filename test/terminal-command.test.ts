import test from 'node:test'
import assert from 'node:assert/strict'
import { Subject } from 'rxjs'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTerminalCommand, setTerminalCommandMode } from '../src/shared/terminal-command'
import { ForwardingServer } from '../src/arw-cli/forwarding-server'

test('terminal commands use the existing shell environment and cwd, capture split markers and keep the parent shell alive',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-terminal-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const shell=spawn('python3',['-c',"import pty; pty.spawn(['/bin/sh','-i'])"],{cwd:root,env:{...process.env,ARW_TERMINAL_TEST:'inherited'}})
    t.after(()=>{shell.stdin.write('exit\r');shell.kill();shell.stdin.destroy();shell.stdout.destroy();shell.stderr.destroy()})
    const output$=new Subject<string>(),closed$=new Subject<void>(),sessionChanged$=new Subject<void>();let visible=''
    const feed=(chunk:Buffer)=>{visible+=chunk.toString();for(let index=0;index<chunk.length;index+=5)output$.next(chunk.subarray(index,index+5).toString())}
    shell.stdout.on('data',feed);shell.stderr.on('data',feed);shell.on('close',()=>closed$.next())
    const tab:any={session:{open:true,output$,closed$,getWorkingDirectory:async()=>root},sessionChanged$,sendInput:(text:string)=>shell.stdin.write(text)}
    setTerminalCommandMode(tab,true)
    const result=await runTerminalCommand(tab,root,'printf "%s:%s" "$ARW_TERMINAL_TEST" "$PWD"; exit 7',new AbortController().signal)
    assert.equal(result.exitCode,7);assert.equal(result.stdout,`inherited:${root}`);assert.equal(result.stderr,'')
    const second=await runTerminalCommand(tab,root,'printf second',new AbortController().signal)
    assert.equal(second.stdout,'second');assert.ok(visible.includes('inherited:'))
    await assert.rejects(runTerminalCommand(tab,'/wrong','echo no',new AbortController().signal),/directory changed/)
    await assert.rejects(runTerminalCommand(tab,root,'printf 123456789',new AbortController().signal,4),/capture limit/)
    setTerminalCommandMode(tab,false)
})

test('terminal mode prevents concurrent commands and interrupts capture when disabled',async()=>{
    const output$=new Subject<string>(),closed$=new Subject<void>(),sessionChanged$=new Subject<void>(),sent:string[]=[]
    const tab:any={session:{open:true,output$,closed$,getWorkingDirectory:async()=>'/project'},sessionChanged$,sendInput:(text:string)=>sent.push(text)}
    setTerminalCommandMode(tab,true)
    const pending=runTerminalCommand(tab,'/project','sleep 10',new AbortController().signal)
    const rejected=assert.rejects(pending,/Terminal mode stopped/)
    await new Promise(resolve=>setImmediate(resolve))
    await assert.rejects(runTerminalCommand(tab,'/project','echo other',new AbortController().signal),/already running/)
    setTerminalCommandMode(tab,false);await rejected
    assert.equal(sent.at(-1),'\x03');assert.equal(output$.observed,false);assert.equal(closed$.observed,false)
    await assert.rejects(runTerminalCommand(tab,'/project','echo no',new AbortController().signal),/not enabled/)
})

test('terminal-only forwarding rejects structured tools before invoking file backends and restores them when disabled',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-terminal-policy-'));t.after(()=>rm(root,{recursive:true,force:true}))
    let enabled=true,reads=0,commands=0
    const server=new ForwardingServer({workspace:{id:'terminal',root,host:'fixture'},terminalOnly:()=>enabled,
        list:async()=>{reads++;return {entries:[]}},read:async()=>{reads++;return {}},write:async()=>{reads++;return {}},
        run:async()=>{commands++;return {stdout:'ok',stderr:'',exitCode:0}}},join(root,'audit.jsonl'))
    const args={workspaceId:'terminal'}
    await assert.rejects(server.invoke({name:'remote_list',arguments:{...args,path:'.'}}),/Terminal mode only supports/)
    await assert.rejects(server.invoke({name:'arw_cli_batch',arguments:{...args,operations:[]}}),/Terminal mode only supports/)
    assert.equal(reads,0)
    const result:any=await server.invoke({name:'run_remote_command',arguments:{...args,command:'echo ok'}})
    assert.equal(result.stdout,'ok');assert.equal(commands,1)
    enabled=false;await server.invoke({name:'remote_list',arguments:{...args,path:'.'}});assert.equal(reads,1)
})
