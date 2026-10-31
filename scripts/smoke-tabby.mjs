// Run only against an isolated Tabby profile started with --remote-debugging-port.
const port=process.argv[2]??'19329'
if(!/^\d+$/.test(port))throw Error('Expected local DevTools port')
const [target]=await(await fetch(`http://127.0.0.1:${port}/json`)).json()
const socket=new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve=>socket.addEventListener('open',resolve))
let id=0;const requests=new Map()
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){requests.get(message.id)?.(message);requests.delete(message.id)}})
async function evaluate(expression){
    const key=++id,result=new Promise(resolve=>requests.set(key,resolve))
    socket.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))
    const response=await result
    if(response.result?.exceptionDetails)throw Error(JSON.stringify(response.result.exceptionDetails))
    return response.result.result.value
}
try{
    const result=await evaluate(`(async()=>{
        const a=require('@angular/core'),core=require('tabby-core'),term=require('tabby-terminal'),fs=require('fs'),path=require('path'),cp=require('child_process'),{Subject}=require('rxjs');
        const injector=a.ɵgetLContext(document.querySelector('app-root')).lView[9],zone=injector.get(a.NgZone),app=injector.get(core.AppService);
        const sidebar=injector.get(core.ToolbarButtonProvider).find(p=>p.constructor.name==='WorkspaceToolbarProvider')?.sidebar;
        if(!sidebar?.component)throw Error('ARW sidebar not mounted');
        const tree=sidebar.component.instance;tree.follow=false;tree.mode='files';
        const root=fs.mkdtempSync('/tmp/arw-modules-smoke-');
        globalThis.__arwModuleSmoke={injector,root,originalTabs:new Set(app.tabs),zone,app};
        fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'README.md'),'before\\n');fs.writeFileSync(path.join(root,'src/main.ts'),'initial\\n');
        const git=(args)=>cp.execFileSync('git',['-C',root,...args],{stdio:'pipe'});
        git(['init','-b','main']);git(['config','user.name','ARW Test']);git(['config','user.email','fixture@example.test']);git(['add','.']);git(['commit','-m','initial']);
        const terminal=await zone.run(()=>injector.get(core.ProfilesService).openNewTabForProfile({type:'local',name:'ARW smoke',options:{command:'/bin/bash',args:['--noprofile','--norc'],cwd:root}}));
        const tick=()=>zone.run(()=>injector.get(a.ApplicationRef).tick());tick();
        const wait=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}throw Error('Timed out waiting for ARW state')};
        await wait(()=>tree.selection?.workspace?.root===root&&tree.nodes.length);
        await zone.run(()=>tree.open(tree.nodes.find(n=>n.name==='src')));
        if(!tree.nodes.some(n=>n.name==='main.ts'&&n.depth===1))throw Error('Lazy expansion failed');
        await zone.run(()=>tree.open(tree.nodes.find(n=>n.name==='README.md')));tick();
        await wait(()=>app.tabs.at(-1).getFocusedTab()?.loading===false);
        const editor=app.tabs.at(-1).getFocusedTab();editor.content='edited\\n';await zone.run(()=>editor.save());
        if(fs.readFileSync(path.join(root,'README.md'),'utf8')!=='edited\\n')throw Error('Editor save failed');
        fs.writeFileSync(path.join(root,'README.md'),'external\\n');editor.content='conflict';await zone.run(()=>editor.save());
        if(!editor.error.includes('changed'))throw Error('Missing conflict detection');editor.content=editor.original;
        zone.run(()=>app.selectTab(app.tabs.find(t=>t.getFocusedTab?.()===terminal)));tick();
        terminal.session.write(Buffer.from('cd src\\n'));await wait(()=>tree.registry.current.value?.workspace?.root===root+'/src');
        if(tree.selection.workspace.root!==root)throw Error('Follow-off did not freeze');
        zone.run(()=>{tree.follow=true;tree.followChanged()});await wait(()=>tree.selection.workspace.root===root+'/src'&&!tree.loading);
        fs.writeFileSync(path.join(root,'src/main.ts'),'modified\\n');await zone.run(()=>tree.gitStatus());
        if(!tree.gitGroups.some(g=>g.changes.some(c=>c.path==='src/main.ts')))throw Error('Git tree failed at nested cwd');
        const localSelection=tree.selection;
        const config=injector.get(core.ConfigService);config.store.omw.agents.codex.command='/bin/bash';config.store.omw.agents.codex.args=['--noprofile','--norc'];
        await zone.run(()=>tree.ai.launch('codex',localSelection));tick();
        await wait(()=>app.tabs.at(-1).getFocusedTab()?.profile);
        const localAi=app.tabs.at(-1).getFocusedTab();
        if(localAi.profile.options.cwd!==root+'/src')throw Error('Local AI cwd mismatch');
        let refs=0;
        const remote={open:true,authUsername:'user',profile:{options:{host:'fixture',port:22}},willDestroy$:new Subject(),ref(){refs++},unref(){refs--}};
        const remoteWorkspace={...localSelection.workspace,id:'remote-fixture',kind:'remote',host:'fixture',root:'/actual/remote',label:'user@fixture:/actual/remote'};
        await zone.run(()=>tree.ai.launch('codex',{...localSelection,remote,workspace:remoteWorkspace}));tick();
        await wait(()=>app.tabs.at(-1).getFocusedTab()?.profile);
        const remoteAi=app.tabs.at(-1).getFocusedTab(),options=remoteAi.profile.options;
        if(options.cwd==='/actual/remote'||!remoteAi.customTitle.includes('/actual/remote'))throw Error('Remote AI binding mislabeled');
        const metadata=JSON.parse(fs.readFileSync(path.join(options.cwd,'.awm/workspace.json'),'utf8'));
        if(metadata.remoteRoot!=='/actual/remote')throw Error('Placeholder metadata mismatch');
        const cli=path.join(path.dirname(options.env.ARW_CONFIG),'bin/arw');
        const output=await new Promise((resolve,reject)=>cp.execFile('node',[cli,'workspaces'],{env:{...process.env,...options.env}},(error,stdout)=>error?reject(error):resolve(stdout)));
        if(JSON.parse(output).workspaces[0].workspaceId!=='remote-fixture')throw Error('Remote CLI context failed');
        return {sidebar:true,localTree:true,lazyExpansion:true,editorSave:true,conflictDetection:true,followToggle:true,nestedGitTree:true,localAiCwd:true,remoteAiPlaceholder:true,remoteCliBinding:true,agentBinary:'Bash fixture; actual AI services not invoked',remoteBackend:'fixture; no real SSH server'};
    })()`)
    console.log(JSON.stringify(result))
}finally{
    await evaluate(`(async()=>{const x=globalThis.__arwModuleSmoke;if(!x)return;for(const tab of [...x.app.tabs])if(!x.originalTabs.has(tab))await x.zone.run(()=>x.app.closeTab(tab,false));await new Promise(r=>setTimeout(r,100));require('fs').rmSync(x.root,{recursive:true,force:true});delete globalThis.__arwModuleSmoke})()`).catch(()=>{})
    socket.close()
}
