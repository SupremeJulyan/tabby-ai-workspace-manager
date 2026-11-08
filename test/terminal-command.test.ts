import test from 'node:test'
import assert from 'node:assert/strict'
import { Subject } from 'rxjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTerminalCommand, setTerminalCommandMode } from '../src/shared/terminal-command'
import { ForwardingServer } from '../src/arw-cli/forwarding-server'

function terminal(){
    const output$=new Subject<string>(),input$=new Subject<Buffer>(),closed$=new Subject<void>()
    const sent:string[]=[]
    const tab:any={session:{open:true,output$,closed$,getWorkingDirectory:async()=>'/project'},input$,sessionChanged$:new Subject(),sendInput:(text:string)=>{sent.push(text);input$.next(Buffer.from(text))}}
    setTerminalCommandMode(tab,true)
    const run=(command:string,maxBytes?:number)=>runTerminalCommand(tab,'/project',command,new AbortController().signal,maxBytes)
    return {tab,sent,output$,input$,closed$,run}
}

test('native Tabby streams capture output without setup commands or fabricated exit codes',async()=>{
    const {sent,output$,run}=terminal()
    const pending=run('touch test')
    await new Promise(resolve=>setTimeout(resolve,0))
    output$.next('touch test\r\nuser$ ')
    const result=await pending
    assert.deepEqual(sent,['touch test\r'])
    assert.deepEqual(result,{stdout:'touch test\nuser$ ',stderr:'',exitCode:null})
    assert.equal(output$.observers.length,0)
})

test('native stream capture stops on disable, disconnect, and output limits',async()=>{
    const {tab,run,sent,output$,closed$}=terminal()
    let pending=run('sleep 10')
    await new Promise(resolve=>setTimeout(resolve,0))
    await assert.rejects(run('echo other'),/already running/)
    const disabled=assert.rejects(pending,/Terminal mode stopped/)
    setTerminalCommandMode(tab,false);await disabled
    assert.equal(sent.at(-1),'\x03')
    assert.equal(output$.observers.length,0)
    setTerminalCommandMode(tab,true)
    pending=run('exit')
    await new Promise(resolve=>setTimeout(resolve,0))
    const closed=assert.rejects(pending,/Terminal closed/);closed$.next();await closed
    pending=run('printf large',4)
    await new Promise(resolve=>setTimeout(resolve,0))
    const limited=assert.rejects(pending,/capture limit/);output$.next('12345');await limited
})

test('terminal-only forwarding rejects structured tools before invoking file backends and restores them when disabled',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-terminal-policy-'));t.after(()=>rm(root,{recursive:true,force:true}))
    let enabled=true,reads=0,commands=0
    const server=new ForwardingServer({workspace:{id:'terminal',root,host:'fixture'},terminalOnly:()=>enabled,
        list:async()=>{reads++;return {entries:[]}},read:async()=>{reads++;return {}},write:async()=>{reads++;return {}},
        run:async(command)=>{assert.equal(command,'touch test');commands++;return {stdout:'ok',stderr:'',exitCode:0}}},join(root,'audit.jsonl'))
    const args={workspaceId:'terminal'}
    await assert.rejects(server.invoke({name:'remote_list',arguments:{...args,path:'.'}}),/Terminal mode uses arw exec/)
    await assert.rejects(server.invoke({name:'arw_cli_batch',arguments:{...args,operations:[]}}),/Terminal mode uses arw exec/)
    assert.equal(reads,0)
    const result:any=await server.invoke({name:'run_remote_command',arguments:{...args,command:'touch test'}})
    assert.equal(result.stdout,'ok');assert.equal(commands,1)
    enabled=false;await server.invoke({name:'remote_list',arguments:{...args,path:'.'}});assert.equal(reads,1)
})


test('multiline input uses native bracketed paste capability and normalizes Windows newlines',async()=>{
    for(const supported of [true,false]){
        const {tab,sent,run}=terminal()
        tab.frontend={supportsBracketedPaste:()=>supported}
        const pending=run('echo first\r\necho second')
        await new Promise(resolve=>setTimeout(resolve,0))
        const rejected=assert.rejects(pending,/Terminal mode stopped/)
        setTerminalCommandMode(tab,false)
        await rejected
        assert.equal(sent[0],supported?'\x1b[200~echo first\necho second\x1b[201~\r':'echo first\recho second\r')
    }
})
