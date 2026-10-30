import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const {ipcFetch}=require('../.build/arw-cli/ipc-client.js')
class BaseTabComponent { ngOnDestroy() {} }
class SSHTabComponent extends BaseTabComponent {}
class TabContextMenuItemProvider {}
class ConfigProvider {}
class SettingsTabProvider {}
class ToolbarButtonProvider {}
class TabRecoveryProvider {}
class TerminalDecorator { detach() {} }
const core = { BaseTabComponent, TabContextMenuItemProvider, ConfigProvider, ToolbarButtonProvider, TabRecoveryProvider,
    TabsService:class{},
    AppService:class{}, ProfilesService:class{},ConfigService:class{},
    TabRecoveryService:class{}, NotificationsService: class {}, PlatformService: class {}, PromptModalComponent: class {}, LogService: class {} }
function load(ssh = { SSHTabComponent }, dom = {}) {
    const module = { exports: {} }
    const reflect = Object.create(Reflect)
    reflect.metadata = (key, value) => target => { target[key] = value }
    runInNewContext(readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8'), {
        module, exports: module.exports, Buffer, process, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
        __dirname: new URL('../dist/',import.meta.url).pathname, ...dom, crypto: globalThis.crypto, Event, KeyboardEvent:class extends Event{}, EventTarget, global: globalThis, Reflect: reflect, URL, Blob, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder,
        ReadableStream, WritableStream, TransformStream, AbortSignal, fetch, performance, setImmediate, clearImmediate,
        require(name) {
            if (name === '@angular/core') return {
                NgZone: class {}, Injector: class {}, ApplicationRef:class{},ComponentFactoryResolver:class{},ChangeDetectorRef:class{},ElementRef:class{},
                ViewChild:()=>()=>{},
                HostListener:()=>()=>{},
                Pipe: metadata => target => { target.pipe = metadata },
                Component: metadata => target => { target.component = metadata },
                Injectable: () => target => target,
                NgModule: metadata => target => { target.ngModule = metadata },
            }
            if (name === '@angular/common') return {CommonModule:class{}}
            if (name === '@angular/forms') return {FormsModule:class{}}
            if (name === '@ng-bootstrap/ng-bootstrap') return { NgbModal: class {} }
            if (name === 'tabby-core') return core
            if (name === 'tabby-settings') return { SettingsTabProvider }
            if (name === 'tabby-terminal') return { TerminalDecorator,BaseTerminalTabComponent:BaseTabComponent }
            if (name === 'tabby-ssh') return ssh
            if (name === 'russh') return { OPEN_CREATE: 8, OPEN_READ: 1, OPEN_TRUNCATE: 16, OPEN_WRITE: 2 }
            return require(name)
        },
    }, { filename: 'dist/index.js' })
    const [WorkspacesService, GitTasksService, menu] = module.exports.default.ngModule.providers
    return { default: module.exports.default, WorkspacesService, GitTasksService,
        ForwardingService: module.exports.default.ngModule.providers[3],
        WorkspaceTerminalDecorator: module.exports.default.ngModule.providers[4].useClass,
        WorkspaceRegistry:module.exports.default.ngModule.providers[5],
        SidebarService:module.exports.default.ngModule.providers[6],
        AiLauncherService:module.exports.default.ngModule.providers[7],
        TreeComponent:module.exports.default.ngModule.declarations[0],
        EditorComponent:module.exports.default.ngModule.declarations[1],
        PreviewComponent:module.exports.default.ngModule.declarations[3],
        FileRecoveryProvider:module.exports.default.ngModule.providers.find(provider=>provider.provide===TabRecoveryProvider).useClass,
        ArwContextMenuProvider: menu.useClass, exports: Object.keys(module.exports) }
}
test('editor, preview and Diff tabs round-trip through JSON recovery with file identity and edit conflicts intact',async()=>{
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-file-recovery-'))
    const plugin=load(),provider=new plugin.FileRecoveryProvider({get:()=>({tabs:[]})})
    const create=async(token)=>{
        const params=await provider.recover(JSON.parse(JSON.stringify(token)))
        const instance=new params.type({get:()=>({detectChanges(){},showMessageBox:async()=>({response:0})})})
        instance.setTitle=()=>{}
        Object.assign(instance,params.inputs)
        await instance.ngOnInit()
        return instance
    }
    const instances=[]
    try{
        await fs.writeFile(join(root,'notes.md'),'# Original')
        const editor=new plugin.EditorComponent({get:()=>({})});editor.setTitle=()=>{}
        editor.workspace=localWorkspace(root);editor.filePath='notes.md';editor.arwPaneLayout='stacked';await editor.ngOnInit();instances.push(editor)
        editor.content='# Unsaved'
        const token=await editor.getRecoveryToken({includeState:true})
        assert.equal(token.state.arwPaneLayout,'stacked')
        assert.equal(await provider.applicableTo(token),true)
        assert.equal(await provider.applicableTo({type:'other'}),false)
        assert.equal((await editor.getRecoveryToken({includeState:false})).state.recoveredEdit,undefined)
        await fs.writeFile(join(root,'notes.md'),'# External change')
        const restored=await create(token);instances.push(restored)
        assert.equal(restored.arwPaneLayout,'stacked')
        assert.equal(restored.content,'# Unsaved');assert.equal(restored.original,'# Original');assert.equal(restored.dirty,true)
        await restored.save()
        assert.equal(restored.error,'');assert.equal(restored.content,'# External change');assert.equal(restored.dirty,false)
        assert.equal(await fs.readFile(join(root,'notes.md'),'utf8'),'# External change')
        const preview=await create({type:'arw-preview',workspace:token.workspace,filePath:'notes.md',state:{imagePaths:[],arwPaneLayout:'stacked'}});instances.push(preview)
        assert.equal(preview.arwPaneLayout,'stacked')
        assert.equal(preview.error,'');assert.match(preview.markdown,/External change/)
        const previewToken=await preview.getRecoveryToken()
        assert.equal(previewToken.type,'arw-preview');assert.equal(previewToken.filePath,'notes.md')
        const diff=await create({type:'arw-editor',workspace:token.workspace,filePath:'notes.md',state:{diffPatch:'--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n',diffLabel:'Saved diff',diffMode:'unified'}});instances.push(diff)
        assert.equal(diff.isDiff,true);assert.equal(diff.readonly,true);assert.equal(diff.diff.added,1);assert.equal(diff.diffMode,'unified')
        assert.equal((await diff.getRecoveryToken()).state.diffLabel,'Saved diff')
        await assert.rejects(provider.recover({type:'arw-editor',filePath:'notes.md'}),/Invalid/)
    }finally{for(const instance of instances)instance.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('file recovery resolves AppService lazily instead of capturing a startup placeholder',async()=>{
    const plugin=load()
    let app,lookups=0
    const provider=new plugin.FileRecoveryProvider({get(token){assert.equal(token,core.AppService);lookups++;return app}})
    assert.equal(lookups,0,'constructing recovery providers must not resolve AppService during its own initialization')
    const token={type:'arw-editor',workspace:{kind:'local',host:'localhost',root:'/project'},filePath:'file.txt'}
    app={}
    await assert.rejects(()=>provider.recover(token),/initialized AppService/)
    app={tabs:[]}
    const recovered=await provider.recover(token)
    assert.equal(recovered.inputs.filePath,'file.txt')
    assert.equal(lookups,2,'each recovery obtains the current initialized service from the injector')
    assert.equal(plugin.FileRecoveryProvider['design:paramtypes'].length,1)
    assert.notEqual(plugin.FileRecoveryProvider['design:paramtypes'][0],core.AppService)
    provider.ngOnDestroy()
})

test('remote file recovery waits for the exact SSH identity and closing a waiting preview cancels recovery',async()=>{
    const plugin=load(),app={tabs:[]},provider=new plugin.FileRecoveryProvider({get:()=>app})
    const workspace={kind:'remote',root:'/project/sub',host:'example.test',port:2222,user:'alice',profileId:'original'}
    const editorParams=await provider.recover({type:'arw-editor',workspace,filePath:'file.txt',state:{initialContent:'snapshot'}})
    const editor=new editorParams.type({get:()=>({})});editor.setTitle=()=>{};Object.assign(editor,editorParams.inputs)
    const loading=editor.ngOnInit()
    const wrong=new SSHTabComponent()
    wrong.sshSession={open:true,profile:{id:'original',options:{host:'example.test',port:2222,user:'bob'}}}
    app.tabs=[{getAllTabs:()=>[wrong]}]
    await new Promise(resolve=>setTimeout(resolve,130))
    assert.equal(editor.loading,true,'another account cannot satisfy recovery')
    const correct=new SSHTabComponent()
    correct.sshSession={open:true,authUsername:'alice',profile:{id:'original',options:{host:'example.test',port:2222,user:'alice'}},ref(){},unref(){},
        willDestroy$:{subscribe:()=>({unsubscribe(){}})}}
    app.tabs=[{getAllTabs:()=>[wrong,correct]}]
    await loading
    assert.equal(editor.error,'');assert.equal(editor.content,'snapshot');assert.equal(editor.workspace.root,'/project/sub')
    const token=await editor.getRecoveryToken()
    assert.equal(token.workspace.user,'alice');assert.equal(token.workspace.port,2222);assert.equal(token.workspace.profileId,'original')
    editor.ngOnDestroy()
    app.tabs=[]
    const previewParams=await provider.recover({type:'arw-preview',workspace,filePath:'image.png'})
    const preview=new previewParams.type({get:()=>({detectChanges(){}})});preview.setTitle=()=>{};Object.assign(preview,previewParams.inputs)
    const pending=preview.ngOnInit()
    assert.equal((await preview.getRecoveryToken()).workspace.profileId,'original')
    preview.ngOnDestroy()
    await pending
    assert.equal(preview.closed,true)

})

test('restored remote files wait without a deadline until their lazily connected SSH tab is ready',async()=>{
    const plugin=load(),app={tabs:[]},provider=new plugin.FileRecoveryProvider({get:()=>app})
    const workspace={kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'}
    const preview=new (await provider.recover({type:'arw-preview',workspace,filePath:'notes.txt'})).type({get:()=>({detectChanges(){}})})
    preview.setTitle=()=>{}
    Object.assign(preview,await provider.recover({type:'arw-preview',workspace,filePath:'notes.txt'}).then(params=>params.inputs))
    const pending=preview.ngOnInit()
    assert.equal(preview.waitingForConnection,true)
    assert.match(preview.connectionStatus,/example\.test/)
    await new Promise(resolve=>setTimeout(resolve,250))
    assert.equal(preview.waitingForConnection,true,'an unopened SSH terminal must not fail recovery')
    const session={open:true,authUsername:'alice',profile:{id:'profile',options:{host:'example.test',port:22,user:'alice'}},ref(){},unref(){},
        willDestroy$:{subscribe:()=>({unsubscribe(){}})},
        openSFTP:async()=>({stat:async()=>({size:5,isDirectory:false}),readdir:async()=>[],open:async()=>({read:async()=>Buffer.alloc(0),close:async()=>{}})})}
    const tab=new SSHTabComponent();tab.sshSession=session
    app.tabs=[{getAllTabs:()=>[tab]}]
    await pending
    assert.equal(preview.waitingForConnection,false)
    assert.equal(preview.workspace.host,'example.test')
    preview.ngOnDestroy()
})

test('an editor still loading is not labelled as a Diff, while a failed read becomes read-only',async()=>{
    const plugin=load(),{localWorkspace}=require('../.build/arw-tree/workspace.js')
    let releaseRead,signalRead
    const readStarted=new Promise(resolve=>{signalRead=resolve})
    const readGate=new Promise(resolve=>{releaseRead=resolve})
    const editor=new plugin.EditorComponent({get:()=>({})})
    editor.setTitle=title=>{editor.shownTitle=title}
    editor.workspace={...localWorkspace('/project'),read:async(path)=>{signalRead();await readGate;throw new Error(`remote read failed: ${path}`)}}
    editor.filePath='notes.txt'
    const pending=editor.ngOnInit()
    await readStarted
    assert.equal(editor.loading,true)
    assert.equal(editor.shownTitle,'Edit · notes.txt')
    editor.ngDoCheck();assert.equal(editor.shownTitle,'Edit · notes.txt')
    releaseRead()
    await pending
    assert.match(editor.error,/remote read failed: notes\.txt/)
    assert.equal(editor.readonly,true)
    editor.ngDoCheck();assert.equal(editor.shownTitle,'Read-only · notes.txt')
    editor.ngOnDestroy()
})

test('restored remote files expose a visible wait state and closing cancels waiting',async()=>{
    const plugin=load(),provider=new plugin.FileRecoveryProvider({get:()=>({tabs:[]})})
    const workspace={kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'}
    const previewParams=await provider.recover({type:'arw-preview',workspace,filePath:'image.png'})
    const preview=new previewParams.type({get:()=>({detectChanges(){}})})
    preview.setTitle=()=>{};Object.assign(preview,previewParams.inputs)
    const loading=preview.ngOnInit()
    assert.equal(preview.waitingForConnection,true)
    assert.match(preview.connectionStatus,/example\.test/)
    assert.equal(preview.waitingForConnection,true)
    preview.ngOnDestroy()
    await loading
})


test('file recovery acquires one pooled session before terminal activation and reads actual SFTP content',async()=>{
    const {Subject}=await import('rxjs'),plugin=load(),terminal=new SSHTabComponent()
    const profile={id:'profile',options:{host:'example.test',port:22,user:'alice'}}
    const app={tabs:[{getAllTabs:()=>[terminal]}]},provider=new plugin.FileRecoveryProvider({get:()=>app})
    const workspace={kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'}
    let connections=0,references=0,reads=0
    const content='print("restored through SFTP")\n'
    const session={open:true,authUsername:'alice',profile,ref(){references++},unref(){references--},
        willDestroy$:new Subject(),ssh:{async openSessionChannel(){return 1},async activateChannel(){
            const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject()
            return {data$,extendedData$,closed$,async requestExec(command){
                const marker=command.match(/ARW_EXIT_[a-f0-9]+/)[0]
                data$.next(Buffer.from(`/project\n/project/notes.py\n\0${marker}:0\0`));closed$.next()
            },async eof(){},async close(){}}
        }},async openSFTP(){return {async stat(){return {size:Buffer.byteLength(content),modified:new Date(1700000000000)}},async open(){
            let sent=false
            return {async read(){reads++;if(sent)return Buffer.alloc(0);sent=true;return Buffer.from(content)},async close(){}}
        }}}}
    terminal.profile=profile;terminal.frontendIsReady=false
    terminal.setupOneSession=async()=>{connections++;await new Promise(resolve=>setTimeout(resolve,10));return session}
    const editors=[]
    try{
        const create=async()=>{
            const params=await provider.recover({type:'arw-editor',workspace,filePath:'notes.py',state:{readonly:true}})
            const editor=new params.type({get:()=>({})});editor.setTitle=()=>{};Object.assign(editor,params.inputs);editors.push(editor)
            await editor.ngOnInit();return editor
        }
        const [first,second]=await Promise.all([create(),create()])
        assert.equal(connections,1,'concurrent file tabs share the authentication handshake')
        assert.equal(terminal.sshSession,undefined,'files do not require a visible terminal shell')
        assert.equal(first.content,content);assert.equal(second.content,content)
        assert.equal(first.error,'');assert.equal(first.loading,false);assert.equal(first.waitingForConnection,false)
        assert.equal(first.readonly,false,'a previous recovery failure must not persist read-only mode')
        assert.ok(reads>=4);assert.equal(references,1)
        const third=await create();assert.equal(third.content,content);assert.equal(connections,1)
    }finally{editors.forEach(editor=>editor.ngOnDestroy());provider.ngOnDestroy()}
    assert.equal(references,0)
})

test('an available terminal unblocks recovery while an earlier file handshake is still pending',async()=>{
    const plugin=load(),terminal=new SSHTabComponent()
    const profile={id:'profile',options:{host:'example.test',port:22,user:'alice'}}
    const app={tabs:[terminal]},provider=new plugin.FileRecoveryProvider({get:()=>app})
    let connections=0
    terminal.profile=profile;terminal.frontendIsReady=false
    terminal.setupOneSession=()=>{connections++;return new Promise(()=>{})}
    const params=await provider.recover({type:'arw-editor',workspace:{kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'},filePath:'file.py',state:{initialContent:'restored'}})
    const editor=new params.type({get:()=>({})});editor.setTitle=()=>{};Object.assign(editor,params.inputs)
    const loading=editor.ngOnInit()
    let deadline
    try{
        await new Promise(resolve=>setImmediate(resolve))
        assert.equal(connections,1)
        terminal.frontendIsReady=true
        terminal.sshSession={open:true,authUsername:'alice',profile,ref(){},unref(){}}
        await Promise.race([loading,new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('Recovery ignored the connected terminal')),1000)})])
        assert.equal(editor.error,'');assert.equal(editor.content,'restored');assert.equal(editor.loading,false)
        assert.equal(editor.waitingForConnection,false)
    }finally{clearTimeout(deadline);editor.ngOnDestroy();provider.ngOnDestroy();await loading}
})

test('pooled file recovery wakes on authentication completion without waiting for its polling timer',async()=>{
    const plugin=load(undefined,{setTimeout:(callback,ms,...args)=>setTimeout(callback,ms===100?10000:ms,...args)})
    const terminal=new SSHTabComponent(),profile={id:'profile',options:{host:'example.test',port:22,user:'alice'}}
    terminal.profile=profile;terminal.frontendIsReady=false
    terminal.setupOneSession=async()=>({open:true,profile,authUsername:'alice',ref(){},unref(){}})
    const provider=new plugin.FileRecoveryProvider({get:()=>({tabs:[terminal]})})
    const params=await provider.recover({type:'arw-editor',workspace:{kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'},
        filePath:'file.txt',state:{initialContent:'ready'}})
    const editor=new params.type({get:()=>({})});editor.setTitle=()=>{};Object.assign(editor,params.inputs)
    const pending=editor.ngOnInit()
    try{
        await new Promise(resolve=>setImmediate(resolve))
        assert.equal(editor.loading,false)
        assert.equal(editor.content,'ready');assert.equal(editor.error,'')
    }finally{editor.ngOnDestroy();provider.ngOnDestroy();await pending}
})

test('closing a recovered file cancels its wait without cancelling shared authentication',async()=>{
    const plugin=load(),terminal=new SSHTabComponent(),profile={id:'profile',options:{host:'example.test',port:22,user:'alice'}}
    const app={tabs:[terminal]},provider=new plugin.FileRecoveryProvider({get:()=>app})
    let finish,refs=0,connections=0
    const session={open:true,authUsername:'alice',profile,ref(){refs++},unref(){refs--}}
    terminal.profile=profile;terminal.frontendIsReady=false
    terminal.setupOneSession=()=>{connections++;return new Promise(resolve=>{finish=()=>resolve(session)})}
    const params=await provider.recover({type:'arw-editor',workspace:{kind:'remote',root:'/project',host:'example.test',port:22,user:'alice',profileId:'profile'},filePath:'file.py'})
    const editor=new params.type({get:()=>({})});editor.setTitle=()=>{};Object.assign(editor,params.inputs)
    const loading=editor.ngOnInit()
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(connections,1)
    editor.ngOnDestroy()
    await loading
    assert.equal(editor.loading,false);assert.equal(editor.content,'')
    finish()
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(refs,1,'a cancelled view must not cancel a shared connection')
    provider.ngOnDestroy();assert.equal(refs,0)
})

test('preview Edit and Replace create editors inside the current split',async()=>{
    for(const layout of ['tiled','stacked'])for(const replace of [false,true]){
        const plugin=load(),created=[],panes=[],workspace={kind:'local',root:'/project'}
        let focused,selected
        const split={getAllTabs:()=>panes,async add(file){panes.push(file)},focus(file){focused=file}}
        const app={tabs:[split],activeTab:split,getParentTab:()=>split,selectTab(tab){selected=tab},
            openNewTab(){throw Error('Editor must stay inside the split')}}
        const tabs={create(params){created.push(params);return {arwFilePane:true,...params.inputs}}}
        const preview=new plugin.PreviewComponent({get:token=>token===core.AppService?app:token===core.TabsService?tabs:{}})
        Object.assign(preview,{workspace,filePath:'README.md',loading:false,encoding:'UTF-8',config:{store:{omw:{fileLayout:layout}}}})
        panes.push(preview)
        preview.search.query='needle'
        preview.edit(replace)
        await new Promise(resolve=>setImmediate(resolve))
        assert.equal(preview.error,'')
        assert.equal(created.length,1)
        assert.equal(created[0].type,plugin.EditorComponent)
        assert.equal(created[0].inputs.workspace,workspace)
        assert.equal(created[0].inputs.filePath,'README.md')
        assert.equal(created[0].inputs.arwPaneLayout,layout)
        assert.equal(created[0].inputs.initialFind?.replaceVisible,replace?true:undefined)
        if(replace)assert.equal(created[0].inputs.initialFind.query,'needle')
        assert.equal(panes.length,2)
        assert.equal(focused,panes[1])
        assert.equal(selected,split)
        assert.deepEqual(app.tabs,[split])
    }
})

test('preview replacement opens an editor with find options and changes stay buffered until save',async()=>{
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),root=await fs.mkdtemp(join(tmpdir(),'arw-find-ui-'))
    const plugin=load(),opened=[],api={detectChanges(){},openNewTab:params=>opened.push(params)}
    const preview=new plugin.PreviewComponent({get:()=>api});preview.setTitle=()=>{}
    const editor=new plugin.EditorComponent({get:()=>api});editor.setTitle=()=>{}
    try{
        await fs.writeFile(join(root,'notes.md'),'foo Foo food')
        preview.workspace=localWorkspace(root);preview.filePath='notes.md';await preview.ngOnInit()
        preview.search.query='foo';preview.search.wholeWord=true;preview.search.open()
        assert.equal(preview.source,true);assert.equal(preview.search.matches.length,2)
        preview.search.open(true)
        assert.equal(opened.length,1);assert.equal(opened[0].type,plugin.EditorComponent)
        assert.equal(opened[0].inputs.initialFind.query,'foo');assert.equal(opened[0].inputs.initialFind.wholeWord,true)
        Object.assign(editor,opened[0].inputs);await editor.ngOnInit()
        assert.equal(editor.search.visible,true);assert.equal(editor.search.replaceVisible,true)
        editor.search.replacement='bar';editor.search.replaceAll()
        assert.equal(editor.content,'bar bar food');assert.equal(editor.dirty,true)
        assert.equal(await fs.readFile(join(root,'notes.md'),'utf8'),'foo Foo food')
        await editor.save();assert.equal(await fs.readFile(join(root,'notes.md'),'utf8'),'bar bar food')
        editor.readonly=true;editor.search.query='bar';editor.search.replacement='blocked';editor.search.replaceAll()
        assert.equal(editor.content,'bar bar food')
    }finally{preview.ngOnDestroy();editor.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('file tabs hide the sidebar and release its width without changing the terminal preference',()=>{
    const {SidebarService,EditorComponent,PreviewComponent}=load()
    const listeners=[]
    const app={activeTab:null,activeTabChange$:{subscribe(callback){listeners.push(callback);return {unsubscribe(){}}}},ready$:{subscribe(){}}}
    const sidebar=new SidebarService(app)
    sidebar.component={}
    sidebar.host={style:{}}
    const classes=new Set()
    sidebar.container={classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name)}}}
    sidebar.install()
    const activate=tab=>{app.activeTab=tab;listeners.forEach(callback=>callback(tab))}
    activate(new BaseTabComponent())
    assert.equal(sidebar.host.style.display,'')
    assert.equal(classes.has('arw-tree-layout'),true)
    for(const Component of [EditorComponent,PreviewComponent]){
        activate(Object.create(Component.prototype))
        assert.equal(sidebar.host.style.display,'none')
        assert.equal(classes.has('arw-tree-layout'),false)
    }
    const first=new BaseTabComponent(),second=new BaseTabComponent()
    activate(first)
    sidebar.toggle()
    assert.equal(sidebar.host.style.display,'none')
    activate(second)
    assert.equal(sidebar.host.style.display,'','another tab has its own visibility')
    activate(first)
    assert.equal(sidebar.host.style.display,'none')
    sidebar.toggle()
    const editor=Object.create(EditorComponent.prototype)
    const source={profile:{type:'ssh',options:{}}}
    const ai={profile:{type:'local',options:{env:{ARW_WORKSPACE_ROOT:'/remote'}}}}
    let focused=source,focusChanged
    const split={getFocusedTab:()=>focused,getAllTabs:()=>[source,editor,ai],focusChanged$:{subscribe(callback){focusChanged=callback;return {unsubscribe(){}}}}}
    activate(split)
    for(const pane of [source,editor,ai]){
        focused=pane;focusChanged()
        assert.equal(sidebar.host.style.display,'','pane focus cannot change the tab sidebar')
    }
    activate({getAllTabs:()=>[editor]})
    assert.equal(sidebar.host.style.display,'none')
    activate({getAllTabs:()=>[ai]})
    assert.equal(sidebar.host.style.display,'none')
    activate(split)
    assert.equal(sidebar.host.style.display,'')
})
function fixture() {
    const plugin = load(), messages = []
    const destroyListeners = new Set()
    const session = { open: true, profile: { options: { host: 'fixture' } },
        async openSFTP() { return { async stat() { return { isDirectory: true } } } },
        willDestroy$: { subscribe(callback) {
            destroyListeners.add(callback)
            return { unsubscribe() { destroyListeners.delete(callback) } }
        } },
    }
    const modal = { open() { return { componentInstance: {}, result: Promise.resolve({ value: '/project' }) } } }
    const notifications = { info: (...args) => messages.push(args), error: (...args) => messages.push(args) }
    const tasks = new plugin.GitTasksService(notifications, {}, {})
    const workspaces = new plugin.WorkspacesService(modal, notifications, tasks)
    const tab = new SSHTabComponent(); tab.sshSession = session
    return { plugin, workspaces, tasks, tab, session, modal, messages, destroyListeners }
}
test('built CommonJS plugin exposes a default NgModule and DI metadata', () => {
    const plugin = load()
    assert.equal(typeof plugin.default, 'function')
    assert.deepEqual(plugin.exports, ['default'])
    const template=plugin.TreeComponent.component.template
    assert.match(template, /class="brand"[^>]*toggleProjects\(\)/)
    assert.match(template, /aria-controls="arw-saved-workspaces"/)
    assert.match(template, /class="brand-title">.*AI Remote Workspace/)
    assert.match(template, /class="workspace-icon"/)
    assert.doesNotMatch(template, /tileAi\(\)|fa-th-large/)
    assert.doesNotMatch(template, /workspace-parent|ARW <small>/)
    new plugin.default({ error() {} },{install(){}},{getLocale:()=> 'zh-CN',localeChanged$:{subscribe:()=>({unsubscribe(){}})}})
    assert.equal(plugin.default.ngModule.providers[2].provide, TabContextMenuItemProvider)
    assert.equal(plugin.WorkspacesService['design:paramtypes'].length, 3)
    assert.equal(plugin.ArwContextMenuProvider['design:paramtypes'][0], plugin.WorkspacesService)
    const configProvider=plugin.default.ngModule.providers.find(entry=>entry.provide===ConfigProvider)
    assert.equal(new configProvider.useClass().defaults.omw.agent.command,'codex')
})

test('workspace tree saves the browsed root and opens files and AI against the saved directory', async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os')
    const {join}=await import('node:path')
    const root=await mkdtemp(join(tmpdir(),'arw-project-tree-'))
    const plugin=load(), config={store:{omw:{}},async save(){}},opened=[],launched=[]
    let persistedProjects={}
    Object.defineProperty(config.store.omw,'projects',{
        get:()=>JSON.parse(JSON.stringify(persistedProjects)),
        set:value=>{persistedProjects=value},
    })
    const provider=plugin.default.ngModule.providers.find(entry=>entry.useFactory)
    const store=provider.useFactory(config)
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const {Subject}=await import('rxjs')
    let echoFilter
    const terminal={session:{open:true,closed$:new Subject(),middleware:{push(filter){echoFilter=filter},remove(){echoFilter=undefined}}},sessionChanged$:new Subject(),sendInput(value){
        this.lastInput=value
        const nonce=/ARW_CD_([a-f0-9]+)/.exec(value)?.[1]
        if(nonce)echoFilter.feedFromSession(Buffer.from(`\x1eARW_CD_${nonce}\x1f`))
    }}, current=new BehaviorSubject({terminal,workspace:localWorkspace(root),hint:''})
    let contextMenu
    const tree=new plugin.TreeComponent({current},{openNewTab:value=>opened.push(value)},{info(){}},{},{},{launchConfigured:async value=>launched.push(value)},{popupContextMenu(items){contextMenu=items}},store)
    try {
        await mkdir(join(root,'src'));await writeFile(join(root,'src/main.ts'),'main')
        await tree.refresh()
        const directory=tree.nodes[0],before=tree.breadcrumb
        tree.showNodeContextMenu(directory,{preventDefault(){},stopPropagation(){}})
        const addDirectory=contextMenu.find(item=>item.label==='添加到工作区')
        assert.equal(addDirectory.enabled,true);await addDirectory.click()
        assert.equal(tree.breadcrumb,before,'adding a directory does not navigate the explorer')
        await tree.open(directory);await tree.addProject()
        assert.equal(tree.projects.length,1)
        const project=tree.projects[0]
        assert.equal(store.connection(project.id),undefined)
        assert.equal(project.root,join(root,'src'))
        await tree.addProject();assert.equal(tree.projects.length,1)
        await tree.selectProject(project)
        assert.equal(tree.breadcrumb,join(root,'src'))
        assert.ok(terminal.lastInput.endsWith(`; cd -- '${project.root}'\r`),'selecting a saved workspace also changes the source terminal directory')
        assert.equal(tree.nodes[0].path,'main.ts')
        await tree.open(tree.nodes[0]);assert.equal(opened[0].inputs.workspace.root,project.root)
        await tree.launchProject(project)
        assert.equal(launched[0].workspace.root,project.root)
        await tree.refresh();assert.equal(tree.breadcrumb,project.root)
        current.next({terminal:{},workspace:localWorkspace(root),hint:''})
        await tree.refresh();assert.equal(tree.projects[0].root,project.root)
        assert.equal(store.list(localWorkspace(join(root,'src'))).length,1)
        await tree.removeProject(project);assert.equal(tree.projects.length,0);assert.equal(store.connection(project.id),undefined)
        assert.match(plugin.TreeComponent.component.template,/launchProject\(project,\$event\)/)
        assert.doesNotMatch(plugin.TreeComponent.component.template,/class="agent-panel"/)
    } finally {tree.ngOnDestroy();await rm(root,{recursive:true,force:true})}
})

test('ARW settings tab persists the executable and separate CLI arguments',async()=>{
    const plugin=load(),config={store:{omw:{agent:{command:'codex',args:[]}}},saves:0,async save(){this.saves++}}
    const agent=config.store.omw.agent
    Object.defineProperty(config.store.omw,'agent',{get:()=>agent})
    const proportions={workspaceWidth:50,aiWidth:50,fileHeight:60,terminalHeight:40}
    Object.defineProperty(config.store.omw,'paneProportions',{enumerable:true,get:()=>proportions})
    const provider=plugin.default.ngModule.providers.find(entry=>entry.provide===SettingsTabProvider)
    const shell={id:'local:default',name:'Bash',type:'local',isBuiltin:true,options:{command:'/bin/bash',args:['--login'],env:{LANG:'C.UTF-8'},shellType:'unix'}}
    const profiles={async getProfiles(){return [shell]}}
    const settings=new (new provider.useClass().getComponentType())(config,profiles)
    const defaultConfig={store:{omw:{}},async save(){}}
    const defaultSettings=new (new provider.useClass().getComponentType())(defaultConfig,profiles)
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(defaultSettings.shellId,'local:default')
    await defaultSettings.save()
    assert.equal(defaultConfig.store.omw.agent.shell.command,'/bin/bash')
    settings.shellId='local:default'
    assert.equal(defaultSettings.command,'codex')
    assert.equal(defaultSettings.argumentsText,'--sandbox\ndanger-full-access\n--ask-for-approval\non-request')
    assert.equal(defaultSettings.proxyUrl,'')
    assert.equal(defaultSettings.resumeArgumentsText,'resume\n--last')
    assert.equal(defaultSettings.fileLayout,'tiled')
    assert.equal(defaultSettings.aiLayout,'tiled')
    assert.equal(defaultSettings.workspaceWidth,50);assert.equal(defaultSettings.aiWidth,50)
    assert.equal(defaultSettings.fileHeight,60);assert.equal(defaultSettings.terminalHeight,40)
    settings.workspaceWidth=70;assert.equal(settings.aiWidth,30)
    settings.aiWidth=35;assert.equal(settings.workspaceWidth,65)
    settings.fileHeight=75;assert.equal(settings.terminalHeight,25)
    settings.terminalHeight=30;assert.equal(settings.fileHeight,70)
    settings.workspaceWidth=0;settings.fileHeight=NaN
    assert.equal(settings.workspaceWidth,65);assert.equal(settings.fileHeight,70)
    settings.fileLayout='stacked';settings.aiLayout='stacked'
    settings.proxyUrl=' http://127.0.0.1:7897 '
    settings.resumeArgumentsText=' --resume \r\n session-id\n --model\n recovery-model '
    settings.command=' /bin/bash ';settings.argumentsText='--noprofile \r\n --norc\n  \nargument with spaces '
    await settings.save()
    assert.equal(config.store.omw.agent.command,'/bin/bash')
    assert.deepEqual(JSON.parse(JSON.stringify(config.store.omw.agent.shell)),{id:'local:default',name:'Bash',command:'/bin/bash',args:['--login'],env:{LANG:'C.UTF-8'},shellType:'unix'})
    assert.deepEqual(JSON.parse(JSON.stringify(config.store.omw.paneProportions)),{workspaceWidth:65,aiWidth:35,fileHeight:70,terminalHeight:30})
    assert.equal(config.store.omw.fileLayout,'stacked')
    assert.equal(config.store.omw.aiLayout,'stacked')
    assert.equal(config.store.omw.agent.proxyUrl,'http://127.0.0.1:7897')
    assert.deepEqual(Array.from(config.store.omw.agent.args),['--noprofile','--norc','argument with spaces'])
    assert.deepEqual(Array.from(config.store.omw.agent.resumeArgs),['--resume','session-id','--model','recovery-model'])
    assert.equal(config.saves,1);assert.equal(settings.saved,true)
    assert.equal(config.store.omw.paneProportions,proportions)
    assert.equal(settings.error,'')
    const reopened=new (new provider.useClass().getComponentType())(config,profiles)
    assert.equal(reopened.workspaceWidth,65);assert.equal(reopened.aiWidth,35);assert.equal(reopened.fileHeight,70);assert.equal(reopened.terminalHeight,30)
    assert.equal(reopened.fileLayout,'stacked');assert.equal(reopened.aiLayout,'stacked')
    settings.resumeArgumentsText='';settings.fileLayout='tiled';settings.aiLayout='stacked';await settings.save()
    assert.equal(config.store.omw.fileLayout,'tiled')
    assert.equal(config.store.omw.aiLayout,'stacked')
    assert.deepEqual(Array.from(config.store.omw.agent.resumeArgs),[])
})

const failureText=(notices)=>notices.map(entry=>entry.join(': ')).join('\n')
for (const savedShell of [true,false]) test(`AI launch resolves the executable inside the ${savedShell?'selected':'default unsaved'} shell`,async()=>{
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const notices=[];let opened=false
    const command='arw-command-that-does-not-exist'
    const shell=process.platform==='win32'?'pwsh.exe':'/bin/bash'
    const profiles={async getProfiles(){return [{id:'local:default',name:'Shell',type:'local',options:{command:shell,args:[],env:{}}}]}}
    let profile
    const config={store:{omw:{agent:{command,args:[],...(savedShell?{shell:{id:'local:default',command:shell,args:[],env:{}}}:{})}}}}
    const before=JSON.stringify(config)
    const launcher=new (load().AiLauncherService)({async getProfiles(){return profiles.getProfiles()},async openNewTabForProfile(value){profile=value;opened=true;return {destroyed$:{subscribe(){return {unsubscribe(){}}}}}}},
        {pin(){}},{error:(...args)=>notices.push(args)},
        config,{},{})
    await launcher.launchConfigured({terminal:{},workspace:{id:'local',...localWorkspace(process.cwd())},hint:''})
    assert.equal(JSON.stringify(config),before,'launch must not persist a default shell')
    assert.equal(opened,true,failureText(notices))
    assert.equal(notices.length,0,failureText(notices))
    assert.equal(profile.options.command,shell)
    const invocation=profile.options.args.join(' ')
    assert.ok(invocation.includes(command),invocation)
})

test('saved remote workspaces are isolated by SSH identity and AI uses the saved absolute root',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs')
    const plugin=load(),config={store:{omw:{}},async save(){}},launched=[]
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory(config)
    const remote={open:true,authUsername:'alice',profile:{options:{host:'host',port:22}},ref(){},unref(){},willDestroy$:new Subject()}
    const workspace={id:'remote',kind:'remote',host:'host',root:'/home/alice',label:'alice@host:/home/alice',list:async()=>[]}
    const current=new BehaviorSubject({terminal:{},workspace,remote,hint:''})
    const tree=new plugin.TreeComponent({current},{},{info(){}},{disable:async()=>{}},{},{launchConfigured:async value=>launched.push(value)},{},store)
    try {
        await tree.refresh();await tree.addProject()
        assert.equal(tree.projects[0].root,'/home/alice')
        await tree.launchProject(tree.projects[0])
        assert.equal(launched[0].workspace.root,'/home/alice')
        assert.equal(launched[0].remote,remote)
        let listedPath
        remote.openSFTP=async()=>({async readdir(path){listedPath=path;return [{name:'src',isDirectory:true,isSymlink:false}]}})
        remote.ssh={async openSessionChannel(){
            const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject()
            return {data$,extendedData$,closed$,async requestExec(command){
                const marker=/ARW_EXIT_[a-f0-9]+/.exec(command)[0]
                data$.next(Buffer.from(`/home/alice\n/home/alice\n\0${marker}:0\0`));closed$.next()
            },async eof(){},async close(){}}
        },async activateChannel(channel){return channel}}
        tree.mode='git';tree.filterText='old-filter';tree.relativePath='old/nested'
        await tree.selectProject(tree.projects[0])
        assert.equal(listedPath,'/home/alice')
        assert.equal(tree.mode,'files')
        assert.equal(tree.filterText,'old-filter')
        assert.equal(tree.relativePath,'')
        assert.equal(tree.breadcrumb,'/home/alice')
        assert.equal(tree.nodes[0].name,'src')
        assert.equal(tree.activeProject,tree.projects[0].id)
        current.next({terminal:{},workspace,remote:{...remote,authUsername:'bob'},hint:''})
        await tree.refresh();assert.equal(tree.projects.length,0)
        current.next({terminal:{},workspace:{...workspace,root:'/other'},remote,hint:''})
        await tree.refresh();assert.equal(tree.projects[0].root,'/home/alice')
    } finally {tree.ngOnDestroy();await store.ngOnDestroy()}
})

test('arw workspaces omits saved-only entries while the catalog preserves their identities',async()=>{
    const {mkdtemp,readFile,rm,stat,writeFile}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os')
    const {join}=await import('node:path')
    const {execFile}=await import('node:child_process')
    const {promisify}=await import('node:util')
    const execute=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'arw-catalog-'))
    const config={store:{omw:{projects:{}}},async save(){}}
    const plugin=load(),provider=plugin.default.ngModule.providers.find(entry=>entry.useFactory)
    const store=provider.useFactory(config,{getConfigPath:()=>join(directory,'config.yaml')},{error(message){throw Error(message)}})
    const env={...process.env,TABBY_CONFIG_DIRECTORY:directory};delete env.ARW_CONFIG
    const cli=(...args)=>execute(process.execPath,[new URL('../dist/arw.cjs',import.meta.url).pathname,...args],{env})
    try {
        await store.syncCatalog()
        assert.deepEqual(JSON.parse((await cli('workspaces')).stdout),{workspaces:[]})
        const local={kind:'local',host:'localhost',root:'/project'}
        const remote={kind:'remote',host:JSON.stringify(['server',2222,'alice']),root:'/remote'}
        const first=await store.add(local,'/project')
        const second=await store.add(remote,'/remote/src')
        let result=JSON.parse((await cli('workspaces')).stdout)
        assert.deepEqual(result.workspaces,[],'saved-only workspaces are not CLI targets')
        assert.equal(store.list(local).length,1)
        const file=join(directory,'omw/workspaces.json')
        assert.doesNotMatch(await readFile(file,'utf8'),/token|connection|password/)
        const catalog=JSON.parse(await readFile(file,'utf8'))
        assert.equal(catalog.workspaces[0].host,'server')
        assert.equal(catalog.workspaces[0].port,2222)
        assert.equal(catalog.workspaces[0].user,'alice')
        assert.equal(catalog.workspaces[0].status,'saved')
        assert.equal('kind' in catalog.workspaces[0],false)
        await writeFile(file,JSON.stringify({version:1,workspaces:[
            {workspaceId:first.id,workspaceRoot:first.root,name:first.name,host:'localhost',kind:'local',status:'saved'},
            {...catalog.workspaces[0],kind:'remote'},
        ]}))
        assert.deepEqual(JSON.parse((await cli('workspaces')).stdout),result)
        if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600)
        await store.remove(local,first)
        result=JSON.parse((await cli('workspaces')).stdout)
        assert.deepEqual(result.workspaces,[])
        const restarted=provider.useFactory(config,{getConfigPath:()=>join(directory,'config.yaml')})
        await restarted.syncCatalog()
        assert.deepEqual(JSON.parse((await cli('workspaces')).stdout).workspaces,[])
        await assert.rejects(cli('workspaces','--saved'),/Unknown option/)
        await assert.rejects(cli('read','file','--id',second.id),/Workspace is not connected/)
        await writeFile(file,'{"version":2,"workspaces":[]}')
        await assert.rejects(cli('workspaces'),/Invalid saved workspace catalog/)
    } finally {await rm(directory,{recursive:true,force:true})}
})

test('saved workspace forwarding routes CLI by ID, survives other entries, and closes on deletion or SSH disconnect',async()=>{
    const {mkdtemp,mkdir,writeFile,readFile,access,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
    const {Subject}=await import('rxjs')
    const execute=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'arw-auto-forward-'))
    const plugin=load(),config={store:{omw:{projects:{}}},async save(){}}
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory(config,{getConfigPath:()=>join(directory,'config.yaml')})
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const env={...process.env,TABBY_CONFIG_DIRECTORY:directory};delete env.ARW_CONFIG
    const cli=(...args)=>execute(process.execPath,[new URL('../dist/arw.cjs',import.meta.url).pathname,...args],{env})
    const closed=new Subject();let refs=0,commandSignal
    const remote={open:true,willDestroy$:closed,ref(){refs++},unref(){refs--}}
    try {
        await mkdir(join(directory,'one'));await mkdir(join(directory,'two'))
        await writeFile(join(directory,'one/file'),'first');await writeFile(join(directory,'two/file'),'second')
        const base={...localWorkspace(directory),kind:'remote',host:'fixture'},first=await store.add(base,join(directory,'one')),second=await store.add(base,join(directory,'two'))
        const fixtureRemote={open:true,willDestroy$:new Subject(),ref(){},unref(){}}
        await Promise.all([store.open(first,{...localWorkspace(first.root),kind:'remote'},fixtureRemote),store.open(second,{...localWorkspace(second.root),kind:'remote'},fixtureRemote)])
        const firstConfig=store.connection(first.id),firstConnection=JSON.parse(await readFile(firstConfig,'utf8'))
        let profile
        const aiClosed=new Subject()
        const launcher=new plugin.AiLauncherService({async getProfiles(){return [{id:'local:default',name:'Bash',type:'local',options:{command:'/bin/bash',args:[],env:{}}}]},async openNewTabForProfile(value){profile=value;return {destroyed$:aiClosed}}},
            {pin(){}},{error(message,detail){throw Error(message+detail)}},
            {store:{omw:{agent:{command:'codex',args:[],shell:{id:'local:default',command:'/bin/bash',args:[],env:{}}}}}},{},{},store)
        await launcher.launchConfigured({terminal:{},hint:'',workspace:{...localWorkspace(first.root),id:first.id}})
        assert.equal(profile.options.env.ARW_CONFIG,undefined)
        const connected=JSON.parse((await cli('workspaces')).stdout).workspaces
        assert.equal(connected.length,2)
        assert.ok(connected.every(entry=>!('status' in entry)&&!('configPath' in entry)))
        assert.equal(JSON.parse((await cli('read','file','--id',first.id)).stdout).content,'first')
        assert.equal(JSON.parse((await cli('read','file','--id',second.id)).stdout).content,'second')
        const pinned=async(...args)=>execute(process.execPath,[new URL('../dist/arw.cjs',import.meta.url).pathname,...args],{env:{...env,ARW_CONFIG:firstConfig}})
        assert.equal(JSON.parse((await pinned('read','file','--id',first.id)).stdout).content,'first')
        assert.equal(JSON.parse((await pinned('read','file','--id',second.id)).stdout).content,'second')
        await cli('write','file','--id',second.id,'--content','updated')
        assert.equal(await readFile(join(second.root,'file'),'utf8'),'updated')
        await store.remove(base,first)
        await assert.rejects(access(firstConfig));await assert.rejects(ipcFetch(firstConnection))
        const cliDirectory=profile.options.env.PATH.split(process.platform==='win32'?';':':')[0]
        aiClosed.next()
        await access(cliDirectory)
        await assert.rejects(cli('read','file','--id',first.id),/Workspace is unavailable/)
        assert.equal(JSON.parse((await cli('read','file','--id',second.id)).stdout).content,'updated')
        const context={kind:'remote',host:JSON.stringify(['host',22,'user']),root:'/remote'}
        const project=await store.add(context,'/remote')
        const backend={...context,host:'host',list:async()=>[],read:async()=>({content:'remote',hash:'hash'}),write:async()=>({}),run:async(command,signal)=>{
            if(command==='wait'){commandSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))}
            return {stdout:'remote',stderr:'',exitCode:0}
        }}
        await store.open(project,backend,remote);await store.open(project,backend,remote)
        assert.equal(refs,1)
        const remoteConfig=store.connection(project.id),remoteConnection=JSON.parse(await readFile(remoteConfig,'utf8'))
        assert.equal((await cli('exec','--id',project.id,'--','pwd')).stdout,'remote')
        remote.open=false;closed.next()
        for(let index=0;index<100&&refs;index++)await new Promise(resolve=>setTimeout(resolve,5))
        await store.syncCatalog()
        assert.equal(refs,0);await assert.rejects(ipcFetch(remoteConnection));await assert.rejects(access(remoteConfig))
        assert.equal(JSON.parse((await cli('workspaces')).stdout).workspaces.some(entry=>entry.workspaceId===project.id),false)
        await assert.rejects(cli('read','file','--id',project.id),/Workspace is not connected/)
        remote.open=true;await store.open(project,backend,remote);assert.equal(refs,1)
        const reconnectedConnection=JSON.parse(await readFile(store.connection(project.id),'utf8'))
        const pendingCommand=ipcFetch(reconnectedConnection,{method:'POST',body:JSON.stringify({name:'run_remote_command',arguments:{workspaceId:project.id,command:'wait'}})}).catch(error=>error)
        for(let index=0;index<100&&!commandSignal;index++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.ok(commandSignal)
        await store.remove(context,project);assert.equal(refs,0)
        assert.equal(commandSignal.aborted,true);await pendingCommand
        await store.remove(base,second)
        const pending=await store.add(base,join(directory,'one'))
        const opening=store.open(pending,{...localWorkspace(pending.root),kind:'remote'},fixtureRemote)
        await store.remove(base,pending);await opening
        assert.equal(store.connection(pending.id),undefined)
    } finally {await store.ngOnDestroy();await rm(directory,{recursive:true,force:true})}
})
test('AI terminal opens as the right split pane of the workspace terminal',async()=>{
    const {Subject}=await import('rxjs')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const plugin=load(),aiClosed=new Subject(),source={}
    let added,focused,selected
    const split={getAllTabs:()=>[source],async add(tab,relative,side){added={tab,relative,side}},focus(tab){focused=tab}}
    const app={tabs:[source],getParentTab(tab){return tab===source?split:null},selectTab(tab){selected=tab},removeTab(){}}
    const launcher=new plugin.AiLauncherService({async getProfiles(){return [{id:'local:default',name:'Bash',type:'local',options:{command:'/bin/bash',args:[],env:{}}}]},async openNewTabForProfile(){return {destroyed$:aiClosed}}},
        {pin(){}},{error(message,detail){throw Error(message+detail)}},
        {store:{omw:{agent:{command:'codex',args:[],shell:{id:'local:default',command:'/bin/bash',args:[],env:{}}}}}},{}, {}, undefined, app)
    await launcher.launchConfigured({terminal:source,sourceTerminal:source,workspace:{id:'local',...localWorkspace(process.cwd())},hint:''})
    assert.equal(added.relative,source)
    assert.equal(added.side,'r')
    assert.equal(focused,added.tab)
    assert.equal(selected,split)
    aiClosed.next()
})



test('AI launch also pairs a legacy unwrapped workspace terminal into a left/right split',async()=>{
    const {Subject}=await import('rxjs')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const plugin=load(),aiClosed=new Subject(),source={},aiTab={destroyed$:aiClosed}
    let added,focused,selected,removed
    const wrapper={getAllTabs:()=>[aiTab],async add(tab,relative,side){added={tab,relative,side}},focus(tab){focused=tab}}
    const app={tabs:[source],getParentTab(tab){return tab===aiTab?wrapper:null},selectTab(tab){selected=tab},removeTab(tab){removed=tab;this.tabs=this.tabs.filter(entry=>entry!==tab)}}
    const launcher=new plugin.AiLauncherService({async getProfiles(){return [{id:'local:default',name:'Bash',type:'local',options:{command:'/bin/bash',args:[],env:{}}}]},async openNewTabForProfile(){return aiTab}},
        {pin(){}},{error(message,detail){throw Error(message+detail)}},
        {store:{omw:{agent:{command:'codex',args:[],shell:{id:'local:default',command:'/bin/bash',args:[],env:{}}}}}},{}, {}, undefined, app)
    await launcher.launchConfigured({terminal:source,workspace:{id:'local',...localWorkspace(process.cwd())},hint:''})
    assert.equal(added.tab,source)
    assert.equal(added.relative,aiTab)
    assert.equal(added.side,'l')
    assert.equal(removed,source)
    assert.equal(focused,aiTab)
    assert.equal(selected,wrapper)
    aiClosed.next()
})
test('workspace binding reuses the session, replaces subscriptions and invalidates on disconnect', async () => {
    const { workspaces, tab, destroyListeners } = fixture()
    await workspaces.bind(tab)
    const first = workspaces.get(tab)
    assert.equal(first.root, '/project')
    assert.equal(first.host, 'fixture')
    await workspaces.bind(tab)
    assert.notEqual(workspaces.get(tab).id, first.id)
    assert.equal(destroyListeners.size, 1)
    for (const listener of destroyListeners) listener()
    assert.equal(workspaces.get(tab), undefined)
    assert.equal(destroyListeners.size, 0)
})
test('sidebar relay failures do not duplicate error notifications while menu callers receive false',async()=>{
    const plugin=load(),messages=[]
    const tasks=new plugin.GitTasksService({error:(...args)=>messages.push(args)},{},{})
    assert.equal(await tasks.run({},undefined,'push'),false)
    assert.equal(messages.length,1)
    await assert.rejects(tasks.run({},undefined,'push',{throwOnError:true}),/请先绑定已连接/)
    assert.equal(messages.length,1,'sidebar failures appear only in the repository panel')
    assert.equal(await tasks.run({},undefined,'fetch',{quiet:true}),false)
    assert.equal(messages.length,1,'automatic failures never notify')
})

test('sidebar relay displays progress, cancels its original source and retains failure details',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const source=new SSHTabComponent(),other=new SSHTabComponent()
    let rejectPush,cancelled,inspections=0
    const tasks={run:async(tab,workspace,direction,options)=>{
        assert.equal(tab,source);assert.equal(direction,'push');assert.equal(options.throwOnError,true)
        options.report('正在使用本地 Git 和凭据推送…')
        return new Promise((resolve,reject)=>{rejectPush=reject})
    },cancel:tab=>{cancelled=tab}}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},tasks,{},{})
    const workspace={kind:'remote',root:'/project',id:'project'},repository={workspace,root:'/project',error:'',groups:[]}
    tree.selection={terminal:source,workspace,hint:''};tree.repositories=[repository]
    tree.recordGitSync=async(entry,direction,operation)=>operation()
    tree.git=()=>({status:async()=>[]})
    tree.loadGitInspector=async()=>{inspections++}
    try{
        const pending=tree.relay('push',repository)
        assert.equal(repository.busy,true)
        assert.match(repository.relayProgress,/本地 Git/)
        tree.selection={terminal:other,workspace,hint:''}
        tree.cancelRelay(repository);assert.equal(cancelled,source)
        rejectPush(new Error('Authentication failed'))
        await pending
        assert.match(repository.error,/Authentication failed/)
        assert.equal(repository.busy,false)
        assert.equal(repository.relayProgress,undefined)
        assert.equal(repository.relayCancel,undefined)
        assert.equal(inspections,0,'failed relay does not wait for history refresh before showing its error')
        assert.match(plugin.TreeComponent.component.template,/cancelRelay\(repository\)/)
    }finally{tree.selection=null;tree.ngOnDestroy()}
})

test('connection changes during validation cannot bind a stale workspace', async () => {
    const { workspaces, tab, session } = fixture()
    session.openSFTP = async () => ({ async stat() {
        tab.sshSession = { ...session }
        return { isDirectory: true }
    } })
    await workspaces.bind(tab)
    assert.equal(workspaces.get(tab), undefined)
})
test('SSH context menu exposes relay actions only after binding', async () => {
    const { plugin, workspaces, tasks, tab } = fixture()
    const menu = new plugin.ArwContextMenuProvider(workspaces, tasks)
    assert.equal((await menu.getItems(new BaseTabComponent())).length, 0)
    assert.equal((await menu.getItems(tab)).length, 1)
    await workspaces.bind(tab)
    const items = await menu.getItems(tab)
    assert.equal(items.length, 3)
    const invoked = []
    tasks.run = async (target, workspace, direction) => { assert.equal(target, tab); invoked.push(direction) }
    await items[1].click(); await items[2].click()
    assert.deepEqual(invoked, ['pull', 'push'])
})

test('unsupported SSH hosts report a compatibility failure instead of hiding menus silently', () => {
    const plugin = load({})
    const messages = []
    assert.doesNotThrow(() => new plugin.default({ error: (...args) => messages.push(args.join(' ')) },{install(){}},{getLocale:()=> 'zh-CN',localeChanged$:{subscribe:()=>({unsubscribe(){}})}}))
    assert.match(messages[0], /升级至兼容版本/)
})


test('tree keeps its browsed root and file tabs bound to a snapshot',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(), terminal={}
    const make=(id,root)=>({id,root,kind:'local',label:root,host:'localhost',async list(){return [{name:'file',path:'file',directory:false,symlink:false}]}})
    const a=make('a','/a'),b=make('b','/b')
    const current=new BehaviorSubject({terminal,workspace:a,hint:''}),opened=[]
    const tree=new plugin.TreeComponent({current},{openNewTab:params=>opened.push(params)},{info(){}},{},{},{},{})
    await tree.refresh()
    current.next({terminal,workspace:b,hint:''})
    assert.equal(tree.selection.workspace,a)
    await tree.open(tree.nodes[0])
    assert.equal(opened[0].inputs.workspace,a)
    await tree.refresh()
    assert.equal(tree.selection.workspace,a)
    current.next({terminal,workspace:make('c','/c'),hint:''})
    assert.equal(tree.selection.workspace.root,'/a')
    assert.equal(opened[0].inputs.workspace.root,'/a')
    tree.ngOnDestroy()
})

test('background directory checks remain silent and preserve unchanged nodes while foreground refreshes show loading',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const files=[{name:'file.txt',path:'file.txt',directory:false,symlink:false}]
    const workspace={id:'silent-refresh',kind:'remote',root:'/project',host:'fixture',label:'fixture',
        async list(){return files},async run(){return {stdout:'',stderr:'not a git repository',exitCode:128}}}
    let renders=0
    const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal:{},workspace,hint:''})},{},{},{},{},{},{},undefined,{detectChanges(){renders++}})
    try{
        tree.ensureGitScan=()=>{}
        tree.cancelGitScan()
        await tree.refresh()
        await new Promise(resolve=>setImmediate(resolve))
        tree.ngAfterViewInit()
        const original=tree.nodes
        tree.error='keep this error'
        renders=0
        let release
        workspace.list=()=>new Promise(resolve=>{release=resolve})
        const unchanged=tree.refreshFiles({preserveError:true,background:true})
        assert.equal(tree.loading,false);assert.equal(renders,0)
        release(files);await unchanged
        assert.equal(tree.nodes,original);assert.equal(tree.error,'keep this error');assert.equal(renders,0)
        const changed=tree.refreshFiles({preserveError:true,background:true})
        assert.equal(tree.loading,false)
        release([...files,{name:'new.txt',path:'new.txt',directory:false,symlink:false}]);await changed
        assert.deepEqual(tree.nodes.map(node=>node.name),['file.txt','new.txt'])
        assert.equal(tree.error,'keep this error');assert.equal(tree.loading,false);assert.equal(renders,1)
        renders=0
        workspace.list=async()=>{throw new Error('background connection failure')}
        await tree.refreshFiles({preserveError:true,background:true})
        assert.equal(tree.error,'keep this error');assert.equal(tree.loading,false);assert.equal(renders,0)
        workspace.list=()=>new Promise(resolve=>{release=resolve})
        const manual=tree.refreshFiles()
        assert.equal(tree.loading,true);assert.equal(renders,1)
        release(files);await manual
        assert.equal(tree.loading,false)
        const background=tree.refreshFiles({preserveError:true,background:true}),finishBackground=release
        const foreground=tree.refreshFiles(),finishForeground=release
        finishBackground(files);await background
        assert.equal(tree.loading,true,'background completion must not clear a newer foreground request')
        finishForeground(files);await foreground
        assert.equal(tree.loading,false)
    }finally{tree.ngOnDestroy()}
})

test('Git discovery keeps cancellation controls without displaying a scanning animation or banner',()=>{
    const template=load().TreeComponent.component.template
    assert.doesNotMatch(template,/正在扫描其余目录并读取状态|正在查找 Git 项目/)
    assert.match(template,/\(click\)="cancelGitScan\(\)"/)
    assert.match(template,/\*ngIf="!gitLoading && !error && !gitNotice && !repositories.length"/)
})

test('only manual refresh enables foreground indicators and stale requests cannot clear a newer refresh',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{info(){}},{disable:async()=>{}},{run:async()=>{}},{},{})
    const pending=[]
    tree.refresh=()=>new Promise(resolve=>pending.push(resolve))
    tree.gitStatus=()=>new Promise(resolve=>pending.push(resolve))
    try{
        assert.equal(tree.manualRefreshing,false)
        const first=tree.refreshCurrentView()
        assert.equal(tree.manualRefreshing,true)
        tree.resetVisibleState()
        assert.equal(tree.manualRefreshing,false)
        tree.mode='git'
        const second=tree.refreshCurrentView()
        pending[0]();await first
        assert.equal(tree.manualRefreshing,true)
        pending[1]();await second
        assert.equal(tree.manualRefreshing,false)
        const template=plugin.TreeComponent.component.template
        assert.match(template,/\*ngIf="loading && manualRefreshing"/)
        assert.match(template,/\[class.spinning\]="manualRefreshing"/)
        assert.doesNotMatch(template,/\[class.spinning\]="(?:loading|node.loading)"/)
    }finally{tree.ngOnDestroy()}
})

test('remote metadata changes refresh silently while tab switches replace the active snapshot watcher',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),current=new BehaviorSubject(null),terminal={}
    const files=[{name:'old.txt',path:'old.txt',directory:false,symlink:false}]
    const snapshots=[]
    const workspace={id:'event-tree',kind:'remote',root:'/project',host:'fixture',label:'fixture',
        list:async()=>files,run:async()=>({stdout:'',stderr:'not a repository',exitCode:128}),
        watchSnapshot(directories,changed,signal){snapshots.push({directories,changed,signal});return new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))}}
    const tree=new plugin.TreeComponent({current},{},{info(){}},{disable:async()=>{}},{run:async()=>{}},{},{})
    let renders=0
    tree.changeDetector={detectChanges(){renders++}}
    try{
        tree.ensureGitScan=()=>{}
        current.next({terminal,workspace,hint:''})
        await tree.refresh()
        tree.viewReady=true;tree.watchWorkspace()
        assert.equal(snapshots.length,1,'remote workspaces start with metadata checks, not a remote event tool')
        assert.equal(tree.watchUnavailable,'')
        files.push({name:'new.txt',path:'new.txt',directory:false,symlink:false})
        const beforeWatchRefresh=tree.nodes
        renders=0
        snapshots[0].changed(['.'])
        await new Promise(resolve=>setTimeout(resolve,100))
        assert.deepEqual(tree.nodes.map(node=>node.name),['old.txt','new.txt'])
        assert.notEqual(tree.nodes,beforeWatchRefresh,'an event replaces the listing once')
        assert.equal(tree.loading,false)
        assert.equal(tree.manualRefreshing,false)
        tree.relativePath='';tree.nodes=[{name:'src',path:'src',directory:true,symlink:false,depth:0,expanded:true}]
        assert.equal(JSON.stringify(tree.snapshotDirectories()),JSON.stringify(['.','src']))
        assert.equal(JSON.stringify(snapshots[0].directories()),JSON.stringify(['.','src']))
        snapshots[0].changed(['src'])
        await new Promise(resolve=>setTimeout(resolve,100))
        assert.equal(tree.snapshotInputs.length,0,'handled snapshot input lists are cleared')
        assert.equal(tree.loading,false)
        tree.watchTab={}
        tree.watchWorkspace()
        assert.equal(snapshots[0].signal.aborted,true,'tab switch stops the old metadata watcher')
        assert.equal(snapshots.length,2)
        assert.equal(snapshots[1].signal.aborted,false)
        tree.ngOnDestroy()
        assert.equal(snapshots[1].signal.aborted,true,'destroy stops the remote metadata watcher')
    }finally{tree.ngOnDestroy()}
})

test('double-clicking a folder enters it and shows its children',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os')
    const {join}=await import('node:path')
    const root=await mkdtemp(join(tmpdir(),'arw-enter-folder-'))
    try{
        await mkdir(join(root,'src'));await writeFile(join(root,'README.md'),'readme');await writeFile(join(root,'src/main.ts'),'main')
        const plugin=load(),terminal={}
        const {localWorkspace}=require('../.build/arw-tree/workspace.js')
        let renders=0
        const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal,workspace:localWorkspace(root),hint:''})},{openNewTab(){}},{info(){}},{},{},{},{},undefined,{detectChanges(){renders++}})
        tree.ngAfterViewInit()
        await tree.refresh()
        assert.deepEqual(tree.nodes.map(node=>node.name),['src','README.md'])
        await tree.open(tree.nodes[0])
        assert.equal(tree.relativePath,'src')
        assert.equal(tree.breadcrumb,`${root}/src`)
        assert.match(plugin.TreeComponent.component.template,/class="current-directory"/)
        assert.match(plugin.TreeComponent.component.template,/'当前目录'/)
        assert.doesNotMatch(plugin.TreeComponent.component.template,/workspace-card|mode-badge|followLabel/)
        assert.deepEqual(tree.nodes.map(node=>node.name),['main.ts'])
        assert.ok(renders>=2)
        await tree.up()
        assert.equal(tree.relativePath,'')
        assert.deepEqual(tree.nodes.map(node=>node.name),['src','README.md'])
        tree.directoryDraft='.'
        await tree.completeDirectory()
        assert.equal(tree.directoryDraft,'.')
        tree.directoryDraft='./sr'
        await tree.completeDirectory()
        assert.equal(tree.directoryDraft,'./src/')
        assert.equal(tree.breadcrumb,root)
        await tree.navigateDirectory()
        assert.equal(tree.breadcrumb,`${root}/src`)
        assert.deepEqual(tree.nodes.map(node=>node.name),['main.ts'])
        tree.directoryDraft='../missing'
        await tree.navigateDirectory()
        assert.equal(tree.breadcrumb,`${root}/src`)
        assert.deepEqual(tree.nodes.map(node=>node.name),['main.ts'])
        assert.ok(tree.error)
        tree.directoryDraft=root
        await tree.navigateDirectory()
        assert.equal(tree.directoryDraft,null)
        await mkdir(join(root,'scripts'))
        await mkdir(join(root,'src','nested'))
        await tree.refresh()
        await tree.updateDirectoryCandidates(`${root}/s`)
        assert.deepEqual(Array.from(tree.directoryCandidates),[`${root}/scripts/`,`${root}/src/`])
        const listing=tree.directoryListings.get(root)
        await tree.updateDirectoryCandidates(`${root}/sc`)
        assert.equal(tree.directoryListings.get(root),listing)
        assert.equal(tree.directoryGhost,'ripts/')
        await tree.updateDirectoryCandidates(`${root}/s`)
        assert.equal(tree.directoryGhost,'cripts/')
        assert.equal(tree.directoryDraft,`${root}/s`)
        tree.moveDirectoryCandidate(1)
        assert.equal(tree.directoryCandidateIndex,1)
        assert.equal(tree.directoryGhost,'rc/')
        tree.syncDirectoryCaret({value:`${root}/s`,selectionStart:1,selectionEnd:1,scrollLeft:12})
        assert.equal(tree.directoryGhost,'')
        tree.syncDirectoryCaret({value:`${root}/s`,selectionStart:root.length+2,selectionEnd:root.length+2,scrollLeft:12})
        assert.equal(tree.directoryGhost,'rc/')
        assert.equal(tree.directoryInputScroll,12)
        assert.match(plugin.TreeComponent.component.template,/aria-autocomplete="inline"/)
        assert.doesNotMatch(plugin.TreeComponent.component.template,/role="listbox"/)
        tree.moveDirectoryCandidate(1)
        assert.equal(tree.directoryCandidateIndex,0)
        tree.moveDirectoryCandidate(-1)
        assert.equal(tree.directoryCandidateIndex,1)
        tree.acceptDirectoryCandidate()
        assert.equal(tree.directoryDraft,`${root}/src/`)
        assert.equal(tree.directoryCandidates.length,0)
        await tree.updateDirectoryCandidates(`${root}/src/n`)
        assert.deepEqual(Array.from(tree.directoryCandidates),[`${root}/src/nested/`])
        const input={value:tree.directoryInput,selectionStart:1,selectionEnd:1,scrollLeft:0,
            setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end}}
        let prevented=0
        const event={preventDefault(){prevented++}}
        tree.completeDirectoryRight(event,input)
        assert.equal(prevented,0)
        assert.equal(tree.directoryDraft,`${root}/src/n`)
        input.setSelectionRange(input.value.length,input.value.length)
        for(const modifier of ['ctrlKey','altKey','metaKey','shiftKey','isComposing']){
            tree.completeDirectoryRight({...event,[modifier]:true},input)
            assert.equal(prevented,0)
        }
        tree.completeDirectoryRight(event,input)
        assert.equal(prevented,1)
        assert.equal(tree.directoryDraft,`${root}/src/nested/`)
        assert.equal(input.value,tree.directoryDraft)
        assert.equal(input.selectionStart,input.value.length)
        assert.equal(tree.directoryCandidates.length,0)
        tree.completeDirectoryRight(event,input)
        assert.equal(prevented,1)
        assert.match(plugin.TreeComponent.component.template,/keydown.arrowright/)
        assert.equal(tree.breadcrumb,root)
        tree.ngOnDestroy()
    }finally{await rm(root,{recursive:true,force:true})}
})

test('symbolic links show a clear browser error instead of opening a broken editor',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),opened=[]
    const workspace={id:'links',kind:'remote',root:'/project',host:'host',label:'host:/project',name:'project',
        async list(){return [{name:'.runtime-cache',path:'.runtime-cache',directory:false,symlink:true}]}}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal:{},workspace,hint:''})},{openNewTab:value=>opened.push(value)},{info(){}},{},{},{},{})
    try{
        await tree.refresh()
        await tree.clickNode(tree.nodes[0],{detail:1})
        assert.equal(opened.length,0)
        assert.match(tree.error,/符号链接/)
        assert.match(tree.error,/\.runtime-cache/)
        await tree.open(tree.nodes[0])
        assert.equal(opened.length,0)
        assert.match(plugin.TreeComponent.component.template,/node\.symlink/)
    }finally{tree.ngOnDestroy()}
})

test('terminal profile labels stay fixed across split changes without touching editor labels',async()=>{
    const {Subject}=await import('rxjs')
    const plugin=load(),tabsChanged=new Subject(),cwd=new Subject()
    let root='/first'
    const source={title:'shell',profile:{type:'local',name:'My terminal'},hasFocus:true,
        focused$:new Subject(),sessionChanged$:new Subject(),
        session:{getWorkingDirectory:async()=>root,oscProcessor:{cwdReported$:cwd},output$:new Subject(),destroyed$:new Subject()},
        setCustomTitle(title){this.customTitle=title;this.customTitleVisible=true},
        setCustomTitleVisible(visible){this.customTitleVisible=visible}}
    const ai={profile:{name:'AI command',options:{env:{ARW_WORKSPACE_ROOT:'/first'}}},title:'local:old'}
    const editor={title:'● Edit · notes.md',customTitle:'notes.md'}
    const split={getAllTabs:()=>[ai,editor,source],setCustomTitle(title){this.customTitle=title},setCustomTitleVisible(){}}
    const app={tabs:[split,editor],tabsChanged$:tabsChanged,activeTabChange$:new Subject()}
    const registry=new plugin.WorkspaceRegistry(app,{run:fn=>fn()})
    registry.register(source)
    try{
        await new Promise(resolve=>setTimeout(resolve,0))
        assert.equal(source.customTitle,'My terminal')
        assert.equal(split.customTitle,'My terminal')
        root='/changed';source.title='process changed title';cwd.next();tabsChanged.next()
        await new Promise(resolve=>setTimeout(resolve,0))
        assert.equal(source.customTitle,'My terminal')
        assert.equal(split.customTitle,'My terminal')
        assert.equal(source.customTitleVisible,false)
        assert.equal(editor.title,'● Edit · notes.md')
        assert.equal(editor.customTitle,'notes.md')
    }finally{registry.unregister(source)}
})

test('workspace registry follows local cwd but a pinned AI context stays fixed',async()=>{
    const {Subject}=await import('rxjs')
    const plugin=load(),changed=new Subject(),cwd=new Subject(),focused=new Subject(),closed=new Subject()
    let root='/first'
    const terminal={profile:{type:'local'},hasFocus:true,focused$:focused,sessionChanged$:changed,
        session:{getWorkingDirectory:async()=>root,oscProcessor:{cwdReported$:cwd},output$:new Subject(),destroyed$:closed}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    registry.register(terminal);await new Promise(r=>setTimeout(r,0))
    assert.equal(registry.current.value.workspace.root,'/first')
    let emissions=0
    const observation=registry.current.subscribe(()=>emissions++)
    const beforeFocus=emissions
    focused.next();registry.activate(terminal)
    await new Promise(r=>setTimeout(r,0))
    assert.equal(emissions,beforeFocus)
    const other={profile:{type:'local'},hasFocus:false,focused$:new Subject(),sessionChanged$:new Subject(),
        session:{getWorkingDirectory:async()=>'/other',oscProcessor:{cwdReported$:new Subject()},output$:new Subject(),destroyed$:new Subject()}}
    registry.register(other);await new Promise(r=>setTimeout(r,0))
    registry.activate(other)
    assert.equal(registry.current.value.workspace.root,'/other')
    registry.activate(terminal)
    assert.equal(registry.current.value.workspace.root,'/first')
    registry.unregister(other);observation.unsubscribe()
    root='/second';cwd.next(root);await new Promise(r=>setTimeout(r,0))
    assert.equal(registry.current.value.workspace.root,'/second')
    registry.pin(terminal,registry.current.value)
    root='/third';cwd.next(root);await new Promise(r=>setTimeout(r,0))
    assert.equal(registry.current.value.workspace.root,'/second')
    registry.unregister(terminal);assert.equal(registry.current.value,null)
})

test('remote AI binding survives decorator remounts, focus and placeholder cwd reports',async()=>{
    const {Subject}=await import('rxjs')
    const plugin=load(),focused=new Subject(),cwd=new Subject(),destroyed=new Subject()
    const source={},remote={open:true},workspace={id:'remote-project',kind:'remote',root:'/remote/project',host:'host',label:'host:/remote/project',list:async()=>[]}
    const terminal={profile:{type:'local'},hasFocus:true,focused$:focused,sessionChanged$:new Subject(),destroyed$:destroyed,
        session:{getWorkingDirectory:async()=>'/local/agent-cwd/placeholder',oscProcessor:{cwdReported$:cwd},output$:new Subject(),destroyed$:new Subject()}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    registry.pin(terminal,{terminal:source,remote,workspace,hint:''})
    for(let iteration=0;iteration<3;iteration++){
        registry.unregister(terminal)
        registry.register(terminal)
        focused.next();cwd.next('/local/agent-cwd/placeholder')
        await new Promise(resolve=>setTimeout(resolve,0))
        assert.equal(registry.current.value.workspace,workspace)
        assert.equal(registry.current.value.remote,remote)
        assert.equal(registry.current.value.sourceTerminal,source)
    }
    destroyed.next()
    assert.equal(registry.get(terminal),undefined)
    assert.equal(registry.current.value,null)
})

test('restored AI placeholder waits for its SSH identity and survives reconnect without becoming local',async()=>{
    const {Subject}=await import('rxjs')
    const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os')
    const {join}=await import('node:path')
    const directory=await mkdtemp(join(tmpdir(),'arw-recovery-'))
    const root=join(directory,'agent-cwd','endpoint','hash')
    await mkdir(root,{recursive:true})
    const makeTerminal=()=>({profile:{type:'local'},hasFocus:false,focused$:new Subject(),sessionChanged$:new Subject(),
        session:{getWorkingDirectory:async()=>root,oscProcessor:{cwdReported$:new Subject()},destroyed$:new Subject()}})
    const ai=makeTerminal(),source=Object.assign(new SSHTabComponent(),makeTerminal())
    ai.profile.options={env:{ARW_LOCAL_WORKSPACE_ROOT:root,ARW_WORKSPACE_KIND:'remote',ARW_WORKSPACE_ROOT:'/remote/project',ARW_WORKSPACE_HOST:'host',ARW_WORKSPACE_PORT:'22',ARW_WORKSPACE_USER:'alice'}}
    source.session.getWorkingDirectory=async()=>'/home/alice'
    source.sshSession={open:true,profile:{options:{host:'host',port:22,user:'bob'}}}
    const registry=new (load().WorkspaceRegistry)({activeTabChange$:new Subject()},{run:fn=>fn()})
    const settle=async()=>{for(let attempt=0;attempt<20;attempt++)await new Promise(resolve=>setTimeout(resolve,2))}
    try{
        registry.register(ai);await settle()
        assert.equal(registry.get(ai).workspace,undefined)
        assert.match(registry.get(ai).hint,/等待连接远程工作区/)
        registry.register(source);await settle()
        assert.equal(registry.get(ai).workspace,undefined)
        source.sshSession.profile.options.user='alice'
        source.sessionChanged$.next();await settle()
        ai.focused$.next()
        assert.equal(registry.current.value.workspace.kind,'remote')
        assert.equal(registry.current.value.workspace.root,'/remote/project')
        assert.equal(registry.current.value.sourceTerminal,source)
        source.focused$.next();await settle()
        assert.equal(registry.current.value.terminal,source)
        source.sshSession.open=false;source.session.destroyed$.next()
        assert.equal(registry.get(ai).workspace,undefined)
        source.sshSession.open=true;source.sessionChanged$.next();await settle()
        assert.equal(registry.get(ai).workspace.root,'/remote/project')
        registry.unregister(source)
        assert.equal(registry.get(ai).workspace,undefined)
        registry.unregister(ai);registry.register(ai);await settle()
        assert.equal(registry.get(ai).workspace,undefined)
    }finally{registry.unregister(source);registry.unregister(ai);await rm(directory,{recursive:true,force:true})}
})

test('remote AI launch uses a persistent placeholder, private session config and stable workspace binding',async()=>{
    const {Subject}=await import('rxjs')
    const {readFile,writeFile,access,mkdtemp,rm}=await import('node:fs/promises')
    const {readWorkspaceCatalog}=require('../.build/arw-cli/workspace-catalog.js')
    const storage=await mkdtemp('/tmp/arw-placeholder-test-')
    const plugin=load(), destroyed=new Subject(),disconnect=new Subject()
    let references=0,profile,pinned,firstProfile,config,secondConfig
    const catalog=()=>readWorkspaceCatalog(storage+'/omw/workspaces.json')
    const session={open:true,authUsername:'user',profile:{options:{host:'host',port:22}},willDestroy$:disconnect,ref(){references++},unref(){references--}}
    const selection={terminal:{},remote:session,workspace:{id:'bound',kind:'remote',root:'/actual/project',label:'user@host:/actual/project',host:'host',
        list:async()=>[],read:async()=>({content:'data',hash:'hash'}),write:async()=>({content:'data',hash:'hash'}),run:async()=>({stdout:'',stderr:'',exitCode:0})}}
    const launcher=new plugin.AiLauncherService({async getProfiles(){return [{id:'local:default',name:'Bash',type:'local',options:{command:'/bin/bash',args:[],env:{}}}]},async openNewTabForProfile(value){profile=value;return {destroyed$:destroyed}}},
        {pin:(tab,value)=>pinned=value},{error(message,detail){throw Error(message+detail)}},
        {store:{omw:{agent:{command:'codex',args:[],shell:{id:'local:default',command:'/bin/bash',args:[],env:{}}}}}},{},{getConfigPath:()=>storage+'/config.yaml'})
    // The VM bundle's __dirname points at this real release directory.
    await launcher.launchConfigured(selection)
    try{
        assert.equal(pinned,selection)
        assert.notEqual(profile.options.cwd,'/actual/project')
        assert.equal(profile.options.command,'/bin/bash')
        assert.deepEqual(profile.options.args.slice(-3),['-i','-c',"exec 'codex'"])
        assert.equal(profile.disableDynamicTitle,undefined)
        const binding=JSON.parse(await readFile(profile.options.cwd+'/.awm/workspace.json','utf8'))
        assert.equal(binding.version,2)
        assert.equal(binding.workspaceId,'bound')
        assert.equal(profile.options.env.ARW_WORKSPACE_ROOT,'/actual/project')
        assert.equal(profile.options.env.ARW_WORKSPACE_USER,'user')
        assert.equal(profile.options.env.ARW_TERMINAL_MODE,undefined)
        assert.ok(profile.options.cwd.startsWith(storage+'/awm/agent-cwd/'))
        assert.equal(profile.options.cwd.split('/').pop(),'host@22@user-actual-project')
        for(const target of ['agents','codex','claude'])await assert.rejects(access(`${profile.options.cwd}/.${target}/skills/arw-cli/SKILL.md`))
        const context=await readFile(profile.options.cwd+'/AGENTS.md','utf8')
        assert.ok(context.includes('/actual/project'))
        assert.match(context,/startup placeholder/)
        assert.match(context,/arw read AGENTS.md/)
        assert.doesNotMatch(context,/arw-cli skill/)
        await assert.rejects(access(profile.options.cwd+'/CLAUDE.md'))
        await writeFile(profile.options.cwd+'/AGENTS.md','legacy')
        assert.equal(profile.options.env.ARW_CONFIG,undefined)
        const firstEntry=(await catalog()).workspaces.find(entry=>entry.workspaceId==='bound')
        assert.equal(profile.options.env.ARW_WORKSPACE_ID,undefined)
        assert.equal(profile.options.env.TABBY_CONFIG_DIRECTORY,storage)
        const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
        const boundRead=await promisify(execFile)(process.execPath,[new URL('../dist/arw.cjs',import.meta.url).pathname,'read','file'],{cwd:profile.options.cwd,env:{...process.env,ARW_WORKSPACE_ID:'wrong-other-workspace'}})
        assert.equal(JSON.parse(boundRead.stdout).content,'data')
        config=JSON.parse(await readFile(firstEntry.configPath,'utf8'))
        const result=await(await ipcFetch(config,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'list_remote_workspaces',arguments:{}})})).json()
        assert.equal(result.result.workspaces[0].workspaceId,'bound')
        firstProfile=profile
        await launcher.launchConfigured({...selection,workspace:{...selection.workspace,id:'second'}})
        assert.notEqual(profile.options.cwd,firstProfile.options.cwd)
        assert.equal(await readFile(firstProfile.options.cwd+'/AGENTS.md','utf8'),'legacy')
        assert.equal(JSON.parse(await readFile(profile.options.cwd+'/.awm/workspace.json','utf8')).workspaceId,'second')
        await assert.rejects(access(profile.options.cwd+'/CLAUDE.md'))
        assert.equal(profile.options.env.ARW_CONFIG,undefined)
        const secondEntry=(await catalog()).workspaces.find(entry=>entry.workspaceId==='second')
        assert.notEqual(secondEntry.configPath,firstEntry.configPath)
        secondConfig=JSON.parse(await readFile(secondEntry.configPath,'utf8'))
        const list=async connection=>(await(await ipcFetch(connection,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'list_remote_workspaces',arguments:{}})})).json()).result.workspaces[0].workspaceId
        assert.equal(await list(config),'bound');assert.equal(await list(secondConfig),'second')
    }finally{
        destroyed.next()
        for(let i=0;i<100&&references;i++)await new Promise(r=>setTimeout(r,10))
        assert.equal(references,0);await access(profile.options.cwd)
        assert.deepEqual((await catalog()).workspaces,[])
        if(config)await assert.rejects(ipcFetch(config))
        if(secondConfig)await assert.rejects(ipcFetch(secondConfig))
        await rm(storage,{recursive:true,force:true})
    }
})

test('remote directory loads from the existing SFTP browser before a terminal report arrives',async()=>{
    const {Subject}=await import('rxjs')
    const plugin=load(),cwd=new Subject(),terminal=new SSHTabComponent()
    let reported=null
    terminal.profile={type:'ssh'};terminal.hasFocus=true;terminal.focused$=new Subject();terminal.sessionChanged$=new Subject()
    terminal.sftpPath='/native/project'
    terminal.sshSession={open:true,profile:{options:{host:'host'}},authUsername:'user',async openSFTP(){return {async stat(path){assert.equal(path,'/native/project');return {isDirectory:true}}}}}
    terminal.session={getWorkingDirectory:async()=>reported,oscProcessor:{cwdReported$:cwd},destroyed$:new Subject()}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    registry.register(terminal);await new Promise(r=>setTimeout(r,0))
    assert.equal(registry.current.value.workspace.root,'/native/project')
    assert.equal(registry.current.value.pathSource,'sftp')
    reported='/actual/remote';cwd.next(reported);await new Promise(r=>setTimeout(r,0))
    assert.equal(registry.current.value.workspace.kind,'remote')
    assert.equal(registry.current.value.workspace.root,'/actual/remote')
    registry.unregister(terminal)
})

test('default SSH browser starts at the resolved login directory instead of filesystem root',async()=>{
    const {Subject}=await import('rxjs'),plugin=load(),terminal=new SSHTabComponent()
    terminal.profile={type:'ssh'};terminal.hasFocus=true;terminal.focused$=new Subject();terminal.sessionChanged$=new Subject()
    terminal.sftpPath='/'
    const cwd=new Subject();let reported=null,commands=0
    terminal.session={getWorkingDirectory:async()=>reported,oscProcessor:{cwdReported$:cwd},destroyed$:new Subject()}
    terminal.sshSession={open:true,profile:{options:{host:'host'}},authUsername:'user',
        ssh:{async openSessionChannel(){return 1},async activateChannel(){
            const data$=new Subject(),closed$=new Subject()
            return {data$,closed$,extendedData$:new Subject(),async close(){},async eof(){},async requestExec(script){
                commands++;assert.match(script,/pwd -P/)
                data$.next(Buffer.from('/home/user\n\0'+script.match(/ARW_EXIT_[a-f0-9]+/)[0]+':0\0'));closed$.next()
            }}
        }},async openSFTP(){return {async stat(path){assert.equal(path,'/home/user');return {isDirectory:true}}}}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    try{
        registry.register(terminal);await new Promise(r=>setTimeout(r,0))
        assert.equal(registry.current.value.workspace.root,'/home/user')
        assert.equal(terminal.sftpPath,'/home/user');assert.equal(commands,1)
        terminal.focused$.next();await new Promise(r=>setTimeout(r,0));assert.equal(commands,1)
        reported='/home/user/project';cwd.next();await new Promise(r=>setTimeout(r,0))
        assert.equal(registry.current.value.workspace.root,reported);assert.equal(registry.current.value.pathSource,'terminal')
    }finally{registry.unregister(terminal)}
})

test('SSH connection readiness and repeated output reuse a pending SFTP validation',async()=>{
    const {Subject}=await import('rxjs'),plugin=load(),terminal=new SSHTabComponent()
    const output=new Subject()
    terminal.sftpPath='/native/initial'
    terminal.profile={type:'ssh'};terminal.hasFocus=true;terminal.focused$=new Subject();terminal.sessionChanged$=new Subject()
    terminal.session={getWorkingDirectory:async()=>null,oscProcessor:{cwdReported$:new Subject()},destroyed$:new Subject(),output$:output}
    let finish,opens=0
    terminal.sshSession={open:false,profile:{options:{host:'host'}},authUsername:'user',async openSFTP(){opens++;await new Promise(resolve=>{finish=resolve});return {async stat(path){assert.equal(path,'/native/initial');return {isDirectory:true}}}}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    try{
        registry.register(terminal);await new Promise(r=>setTimeout(r,0))
        assert.equal(registry.current.value.workspace,undefined);assert.equal(opens,0)
        terminal.sshSession.open=true;output.next(Buffer.from('prompt'))
        await new Promise(r=>setTimeout(r,230));assert.equal(opens,1)
        terminal.focused$.next();await new Promise(r=>setTimeout(r,0));assert.equal(opens,1)
        finish();await new Promise(r=>setTimeout(r,0))
        assert.equal(registry.current.value.workspace.root,'/native/initial');assert.equal(registry.current.value.pathSource,'sftp')
        terminal.focused$.next();await new Promise(r=>setTimeout(r,0));assert.equal(opens,1)
    }finally{registry.unregister(terminal)}
})

test('remote tree forwarding operates without the native SFTP panel and is revoked on root change',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs')
    const {access}=await import('node:fs/promises')
    const plugin=load(),terminal=new SSHTabComponent()
    let references=0,copied
    terminal.sftpPanelVisible=false
    terminal.sshSession={open:true,profile:{options:{host:'host'}},willDestroy$:new Subject(),ref(){references++},unref(){references--},
        async openSFTP(){return {async stat(){return {isDirectory:true}}}}}
    const workspace={id:'tree',kind:'remote',root:'/project',host:'host',label:'host:/project',list:async()=>[]}
    const current=new BehaviorSubject({terminal,workspace,remote:terminal.sshSession,hint:''})
    const forwarding=new plugin.ForwardingService({info(){},error(message,detail){throw Error(message+detail)}},{setClipboard(value){copied=value.text}})
    const tree=new plugin.TreeComponent({current},{},{},forwarding,{},{},{})
    let config
    try{
        await tree.toggleForwarding()
        assert.equal(tree.forwarded,true);assert.equal(references,1)
        config=forwarding.state(terminal,'/project').configPath
        tree.copyCli();assert.equal(copied,'arw workspaces');assert.doesNotMatch(copied,/--config/)
        current.next({terminal:{},workspace:{...workspace,id:'next',kind:'local',root:'/next'},hint:''})
        for(let i=0;i<100&&references;i++)await new Promise(r=>setTimeout(r,10))
        for(let i=0;i<100&&references;i++)await new Promise(r=>setTimeout(r,10))
        assert.equal(tree.forwarded,false);assert.equal(references,0)
        await assert.rejects(access(config))
    }finally{tree.ngOnDestroy();await forwarding.disable(terminal)}
})

test('Git view groups projects, preserves folding, and opens files against their own repository',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {promisify}=await import('node:util'),{execFile}=await import('node:child_process')
    const execute=promisify(execFile),root=await mkdtemp(join(tmpdir(),'arw-repository-view-'))
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const plugin=load(),opened=[]
    const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal:{},workspace:localWorkspace(root),hint:''})},
        {openNewTab:params=>opened.push(params)},{},{},{},{},{})
    try{
        await tree.refresh();await tree.gitStatus()
        assert.equal(tree.error,'');assert.equal(tree.repositories.length,0)
        for(const name of ['one','two']){await execute('git',['init',join(root,name)]);await writeFile(join(root,name,'same.txt'),name)}
        await tree.gitStatus()
        assert.equal(tree.repositories.length,2)
        assert.ok(tree.repositories.every(repo=>!repo.expanded))
        tree.toggleRepository(tree.repositories[0]);assert.equal(tree.repositories[0].expanded,true)
        await tree.gitStatus();assert.equal(tree.repositories[0].expanded,true)
        const firstEntry=tree.repositories[0],secondEntry=tree.repositories[1],secondGroups=secondEntry.groups
        let secondCalls=0;const secondRun=secondEntry.workspace.run
        secondEntry.workspace.run=async(...args)=>{secondCalls++;return secondRun(...args)}
        await tree.stageChange(firstEntry.groups[1].changes[0],firstEntry)
        assert.equal(tree.repositories[0],firstEntry)
        assert.equal(tree.repositories[1],secondEntry)
        assert.equal(secondEntry.groups,secondGroups)
        assert.equal(secondCalls,0)
        const second=tree.repositories[1]
        await tree.openChange(second.groups[1].changes[0],false,second)
        assert.equal(opened[0].inputs.workspace.root,join(root,'two'))
        assert.equal((await opened[0].inputs.workspace.read('same.txt')).content,'two')
        assert.equal(opened[0].inputs.readonly,true)
        assert.equal(opened[0].inputs.diffStaged,false)
        assert.match(opened[0].inputs.diffPatch,/\+two/)
    }finally{tree.ngOnDestroy();await rm(root,{recursive:true,force:true})}
})

test('Git view stages, unstages and commits the saved project through its actual backend',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {promisify}=await import('node:util'),{execFile}=await import('node:child_process')
    const execute=promisify(execFile),root=await mkdtemp(join(tmpdir(),'arw-git-actions-'))
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const plugin=load(),config={store:{omw:{}},async save(){}},projects={}
    Object.defineProperty(config.store.omw,'projects',{get:()=>projects,set:value=>{projects=value}})
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory(config)
    const confirmations=[];let confirmationResponse=0
    await execute('git',['init',root])
    await execute('git',['-C',root,'config','user.name','ARW Test'])
    await execute('git',['-C',root,'config','user.email','arw@example.test'])
    await writeFile(join(root,'first.txt'),'first')
    const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal:{},workspace:localWorkspace(root),hint:''})},
        {openNewTab(){}},{info(){}},{},{},{},{async showMessageBox(options){confirmations.push(options);return {response:confirmationResponse}}},store)
    try{
        await tree.refresh();await tree.gitStatus()
        let repository=tree.repositories[0];const reload=()=>tree.repositories[0]
        let fullRefreshes=0;const fullRefresh=tree.gitStatus.bind(tree)
        tree.gitStatus=async()=>{fullRefreshes++;await fullRefresh()}
        tree.setCommitMessage(repository,'draft retained')
        await tree.stageChange(reload().groups[1].changes[0],reload())
        assert.equal(tree.repositories[0],repository)
        assert.equal(tree.commitMessage(repository),'draft retained')
        repository=reload()
        assert.equal(repository.groups[0].changes.length,1)
        assert.equal(repository.groups[1].changes.length,0)
        await tree.unstageChange(reload().groups[0].changes[0],reload())
        repository=reload()
        assert.equal(repository.groups[0].changes.length,0)
        await tree.stageAll(repository)
        repository=reload()
        assert.equal(repository.groups[0].changes.length,1)
        tree.setCommitMessage(repository,'initial commit')
        await tree.commit(repository)
        repository=reload()
        assert.equal(repository.message,'已提交')
        assert.equal(repository.count,0)
        assert.equal(tree.commitMessage(repository),'')
        assert.equal((await execute('git',['-C',root,'log','-1','--format=%s'])).stdout.trim(),'initial commit')
        assert.equal(repository.syncState.kind,'no-upstream')
        assert.match(tree.gitSyncLabel(repository),/未配置上游/)
        await tree.localSync('push',repository)
        assert.match(repository.error,/未配置上游/)
        assert.equal(repository.busy,false)
        assert.equal(repository.syncState.kind,'no-upstream')
        const remoteEntry={...repository,workspace:{...repository.workspace,kind:'remote'}}
        await tree.localSync('push',remoteEntry)
        assert.equal(remoteEntry.error,repository.error,'local synchronization ignores remote repositories')
        const template=plugin.TreeComponent.component.template
        for(const action of ['fetch','pull','push'])assert.equal(template.split(`syncGit('${action}',repository)`).length-1,1)
        assert.doesNotMatch(template,/localSync\(|relay\(/)
        assert.equal(fullRefreshes,0)
        await writeFile(join(root,'second.txt'),'second')
        await tree.gitStatus()
        tree.setCommitMessage(reload(),'must be staged')
        await tree.commit(reload())
        assert.match(reload().error,/先暂存/)
        await writeFile(join(root,'first.txt'),'changed')
        await tree.gitStatus()
        repository=reload()
        const changed=repository.groups[1].changes.find(change=>change.path==='first.txt')
        await tree.discardChanges(repository,changed)
        assert.equal(await readFile(join(root,'first.txt'),'utf8'),'changed')
        assert.equal(repository.busy,false)
        confirmationResponse=1
        const refreshesBefore=fullRefreshes
        await tree.discardChanges(repository,changed)
        assert.equal(await readFile(join(root,'first.txt'),'utf8'),'first')
        assert.equal(tree.repositories[0],repository)
        assert.equal(fullRefreshes,refreshesBefore)
        const untracked=repository.groups[1].changes.find(change=>change.path==='second.txt')
        await tree.discardChanges(repository,untracked)
        await assert.rejects(readFile(join(root,'second.txt')))
        assert.match(confirmations.at(-1).detail,/永久删除/)
        assert.equal(repository.count,0)
    }finally{
        await tree.ngOnDestroy();await store.ngOnDestroy();await rm(root,{recursive:true,force:true})
    }
})

test('diff editor parses templates, renders structured escaped text and navigates hunks read-only',async()=>{
    const plugin=load(),compiler=await import('@angular/compiler')
    for(const component of [plugin.TreeComponent,plugin.EditorComponent,plugin.PreviewComponent]){
        const parsed=compiler.parseTemplate(component.component.template,'arw-test.html')
        assert.equal(parsed.errors,null,parsed.errors?.map(error=>error.toString()).join('\n'))
    }
    const editor=new plugin.EditorComponent({get:()=>({})})
    editor.setTitle=()=>{}
    editor.workspace={label:'fixture',read(){throw Error('diff must not read or overwrite the live worktree')}}
    editor.filePath='file'
    editor.diffPatch='@@ -1 +1 @@\n-before\n+<img src=x onerror=alert(1)>\n@@ -10 +10 @@\n-other\n+next\n'
    await editor.ngOnInit()
    assert.equal(editor.error,'');assert.equal(editor.loading,false);assert.equal(editor.readonly,true)
    assert.equal(editor.visibleHunks.length,2)
    editor.nextHunk();assert.equal(editor.activeHunk,0);assert.equal(editor.visibleHunks.length,1)
    editor.nextHunk();assert.equal(editor.activeHunk,1)
    editor.previousHunk();assert.equal(editor.activeHunk,0)
    assert.equal(editor.diff.hunks[0].lines[1].text,'<img src=x onerror=alert(1)>')
    const template=plugin.EditorComponent.component.template
    const diffSection=template.slice(template.indexOf('<ng-container *ngIf="isDiff'),template.indexOf('<div *ngIf="markdownPreview'))
    assert.doesNotMatch(diffSection,/innerHTML/)
    await editor.toggleMarkdown();assert.equal(editor.markdownPreview,false,'Diff content never enters the Markdown renderer')
    assert.match(plugin.EditorComponent.component.template,/diffMode='split'/)
    assert.match(plugin.EditorComponent.component.template,/diffMode='unified'/)
    await editor.save();assert.equal(editor.dirty,false)
    assert.equal(await editor.canClose(),true)
})

test('terminal mode synchronizes its source once; refresh preserves the selected directory',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs')
    const {spawn}=await import('node:child_process')
    const {mkdtemp,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await mkdtemp(join(tmpdir(),'arw-terminal-mode-'))
    const plugin=load(),config={store:{omw:{}},async save(){}},notices=[],launched=[]
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory(config)
    let pwd=root,pwdReads=0
    const terminal=new SSHTabComponent()
    const remote={open:true,profile:{options:{host:'fixture'}},willDestroy$:new Subject(),ref(){},unref(){},
        ssh:{async openSessionChannel(){return {}},async activateChannel(){
            const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
            return {data$,extendedData$,closed$,async requestExec(command){
                child=spawn('/bin/sh',['-c',command],{cwd:root})
                child.stdout.on('data',chunk=>data$.next(chunk));child.stderr.on('data',chunk=>extendedData$.next([1,chunk]))
                child.on('error',()=>closed$.next());child.on('close',()=>closed$.next())
            },async eof(){child.stdin.end()},async close(){child?.kill()}}
        }},async openSFTP(){throw Error('subsystem request failed')}}
    terminal.sendInput=()=>{}
    terminal.sshSession=remote
    terminal.session={open:true,getWorkingDirectory:async()=>{pwdReads++;return pwd}}
    const workspace={...localWorkspace(root),kind:'remote',host:'fixture'}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null),async prepareCwdIntegration(){return {command:'pwd',async cleanup(){}}}},
        {openNewTab(){}},{info(message){notices.push(message)}},{async disable(){}},{},{launchConfigured:async selection=>launched.push(selection)},{},store)
    tree.selection={terminal,remote,workspace,hint:''}
    tree.ensureGitScan=()=>{}
    try{
        await tree.refresh();await tree.addProject()
        assert.equal(tree.projects.length,1)
        const saved=tree.projects[0]
        await tree.toggleTerminalMode()
        assert.equal(tree.terminalMode,true)
        assert.equal(tree.projects[0].id,'terminal')
        assert.equal(tree.projects[0].root,root)
        await tree.addProject()
        assert.equal(tree.projects.length,1)
        pwd=tmpdir()
        assert.equal(tree.projects[0].root,root)
        await tree.refresh()
        assert.equal(tree.projects.length,1)
        assert.equal(tree.projects[0].root,root)
        assert.equal(tree.breadcrumb,root)
        assert.equal(pwdReads,1)
        await tree.followTerminal()
        assert.equal(pwdReads,2)
        assert.equal(tree.projects[0].root,pwd)
        assert.equal(tree.breadcrumb,pwd)
        await tree.launchProject(tree.projects[0])
        assert.equal(launched.length,1)
        assert.equal(launched[0].workspace.root,pwd)
        assert.equal(launched[0].terminal,terminal)
        assert.equal(store.list(tree.projectContext(workspace)).length,1)
        await tree.toggleTerminalMode()
        assert.equal(tree.projects[0].id,saved.id)
        pwd=root
        await tree.followTerminal()
        assert.equal(tree.terminalMode,false)
        assert.equal(pwdReads,3)
        assert.equal(tree.breadcrumb,root)
        assert.equal(tree.projects[0].id,saved.id)
        assert.equal(tree.commitMessage(tree.repositories[0]??{}),'')
        pwd=null;await tree.followTerminal()
        assert.equal(tree.breadcrumb,root)
        assert.equal(tree.cwdSetupPending,true)
        const template=plugin.TreeComponent.component.template
        assert.match(template,/\|\| terminalMode.*addProject\(\)/s)
        assert.match(template,/followTerminal\(\)/)
        assert.match(template,/\[title\]="'跟随终端当前目录（单击一次）' \| arwTranslate"/)
        assert.match(template,/toggleTerminalMode\(\)/)
        assert.match(template,/\*ngIf="terminalMode" class="fas fa-terminal"/)
        assert.match(template,/\*ngIf="!terminalMode" class="workspace-icon"/)
        assert.match(template,/class="project-ai"[^>]* \(click\)="launchProject\(project,\$event\)"/)
        assert.match(template,/stageChange\(change,repository\)/)
        assert.match(template,/commit\(repository\)/)
    }finally{await store.ngOnDestroy?.();tree.ngOnDestroy();await rm(root,{recursive:true,force:true})}
})

test('connected SSH without cwd exposes one-click session setup and follows the first actual report',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load(),terminal=new SSHTabComponent(),sent=[]
    terminal.sshSession={open:true,authUsername:'user',profile:{options:{host:'host'}}}
    terminal.session={open:true};terminal.alternateScreenActive=true;terminal.sendInput=value=>sent.push(value)
    const current=new BehaviorSubject({terminal,remote:terminal.sshSession,hint:'等待路径'})
    const tree=new plugin.TreeComponent({current,async prepareCwdIntegration(){return {command:'. /tmp/arw-fixture.sh',cleanup:async()=>{}}}},{},{},{disable:async()=>{}},{},{},{setClipboard(){}})
    try{
        assert.equal(tree.isRemote,true);assert.match(tree.connectionLabel,/SSH 已连接/)
        assert.equal(tree.workspaceLabel,'user@host');assert.equal(tree.canEnableCwd,true)
        tree.enableCwd();assert.equal(sent.length,0);assert.match(tree.cwdSetupError,/退出全屏/)
        terminal.alternateScreenActive=false;await tree.enableCwd()
        assert.equal(sent.length,1);assert.equal(tree.cwdSetupPending,true)
        assert.match(sent[0],/^ \. \/tmp\/arw-fixture\.sh\r$/)
        current.next({terminal,remote:terminal.sshSession,hint:'',workspace:{id:'actual',kind:'remote',root:'/actual/path',host:'host',label:'user@host:/actual/path',list:async()=>[]}})
        assert.equal(tree.cwdSetupPending,false);assert.equal(tree.selection.workspace.root,'/actual/path')
    }finally{tree.ngOnDestroy()}
})


test('sidebar omits the SFTP notice and manual locate controls',()=>{
    const template=load().TreeComponent.component.template
    assert.doesNotMatch(template,/sftp-notice|已自动加载 SFTP|locateTerminal|定位当前目录/)
})

test('Git history and branches use the repository backend and preserve dirty work when switching',async()=>{
    const plugin=load(),{BehaviorSubject}=await import('rxjs')
    const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await mkdtemp(join(tmpdir(),'arw-git-inspector-')),workspace=localWorkspace(root),opened=[],confirmations=[]
    const current=new BehaviorSubject(null)
    let answer=0
    const tree=new plugin.TreeComponent({current},
        {openNewTab:entry=>opened.push(entry)},{info(){}},{},{},{},{async showMessageBox(options){confirmations.push(options);return {response:answer}}})
    try{
        for(const command of ['git init -b main',"git config user.name 'ARW Test'",'git config user.email arw@example.test'])assert.equal((await workspace.run(command)).exitCode,0)
        await writeFile(join(root,'file.txt'),'first\n')
        for(const command of ['git add file.txt','git commit -m initial','git branch feature'])assert.equal((await workspace.run(command)).exitCode,0)
        current.next({terminal:{},workspace,hint:''})
        await tree.refresh();await tree.gitStatus()
        const repository=tree.repositories[0]
        assert.equal(repository.inspectorError,'')
        assert.equal(repository.inspectorPending,false)
        assert.equal(repository.commits.length,1)
        assert.equal(repository.commits[0].subject,'initial')
        assert.equal(repository.branches.find(branch=>branch.current).name,'main')
        tree.showInspector(repository,'history');assert.equal(repository.inspector,'history')
        tree.showInspector(repository,'branches');assert.equal(repository.inspector,'branches')
        await tree.openCommit(repository,repository.commits[0])
        assert.equal(opened[0].inputs.workspace.root,root)
        assert.match(opened[0].inputs.diffPatch,/\+first/)
        assert.equal(opened[0].inputs.readonly,true)
        assert.match(opened[0].inputs.diffDescription,/initial/)
        await writeFile(join(root,'file.txt'),'dirty\n')
        const feature=repository.branches.find(branch=>branch.name==='feature')
        await tree.switchBranch(repository,feature)
        assert.equal(confirmations.length,1)
        assert.equal((await workspace.run('git symbolic-ref --short HEAD')).stdout.trim(),'main')
        answer=1;await tree.switchBranch(repository,feature)
        assert.equal(repository.error,'')
        assert.equal(repository.branch,'feature')
        assert.equal(await readFile(join(root,'file.txt'),'utf8'),'dirty\n')
        assert.match(plugin.TreeComponent.component.template,/trackBy: trackCommit/)
    }finally{tree.ngOnDestroy();await rm(root,{recursive:true,force:true})}
})

test('Git status waits for the active inspector scan instead of returning partially loaded history',async()=>{
    const plugin=load(),{BehaviorSubject}=await import('rxjs')
    const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
    const {tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await mkdtemp(join(tmpdir(),'arw-git-inspector-pending-')),workspace=localWorkspace(root)
    const current=new BehaviorSubject(null),tree=new plugin.TreeComponent({current},{},{},{},{},{},{})
    let releaseInspector,inspectorStarted
    const started=new Promise(resolve=>{inspectorStarted=resolve})
    const released=new Promise(resolve=>{releaseInspector=resolve})
    const inspect=tree.loadGitInspector.bind(tree)
    tree.loadGitInspector=async(...args)=>{inspectorStarted();await released;await inspect(...args)}
    let pending
    try{
        for(const command of ['git init -b main',"git config user.name 'ARW Test'",'git config user.email arw@example.test'])assert.equal((await workspace.run(command)).exitCode,0)
        await writeFile(join(root,'file.txt'),'first\n')
        for(const command of ['git add file.txt','git commit -m initial'])assert.equal((await workspace.run(command)).exitCode,0)
        current.next({terminal:{},workspace,hint:''})
        await started
        const repository=tree.repositories[0]
        assert.equal(repository.commits.length,0)
        assert.equal(tree.gitLoading,true)
        let completed=false
        pending=tree.gitStatus().then(()=>{completed=true})
        await Promise.resolve()
        assert.equal(completed,false,'joining an active scan must wait for history and branches')
        releaseInspector();await pending
        assert.equal(tree.gitLoading,false)
        assert.equal(repository.inspectorPending,false)
        assert.equal(repository.commits[0].subject,'initial')
        assert.equal(repository.branches.find(branch=>branch.current).name,'main')
    }finally{releaseInspector();tree.ngOnDestroy();await pending;await rm(root,{recursive:true,force:true})}
})

test('AI activity is a sibling tab with stable expandable entries and category/status filters',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),template=plugin.TreeComponent.component.template
    assert.match(template,/setMode\('activity'\)/)
    assert.match(template,/trackBy: trackActivity/)
    assert.doesNotMatch(template,/\[innerHTML\]/)
    assert.ok(template.indexOf("setMode('activity')")<template.indexOf('<ng-container *ngIf="selection?.workspace'))
    const confirmations=[]
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{async showMessageBox(options){confirmations.push(options);return {response:0}}})
    try{
        tree.mode='activity'
        tree.selection={remote:{},terminal:{}}
        Object.defineProperty(tree,'activities',{value:[{id:1,category:'read',status:'success',operation:'remote_read'},
            {id:2,category:'command',status:'denied',operation:'run_remote_command'},
            {id:3,category:'command',status:'running',operation:'run_remote_command'}]})
        assert.equal(tree.runningActivities,1)
        tree.activityCategory='command';tree.activityStatus='error'
        assert.equal(tree.visibleActivities.length,1)
        assert.equal(tree.visibleActivities[0].id,2)
        assert.equal(tree.activityState(tree.visibleActivities[0]),'已拦截')
        assert.equal(tree.activityLabel(tree.activities[0]),'读取文件')
        assert.equal(tree.trackActivity(0,tree.activities[1]),2)
        await tree.clearActivities()
        assert.equal(confirmations.length,1)
        assert.match(confirmations[0].message,/安全审计日志会保留/)
        assert.equal(tree.activities.length,3)
    }finally{tree.ngOnDestroy()}
})

test('shell integration stages privately through SFTP and sends only a short source command',async()=>{
    const {Subject}=await import('rxjs'),{spawn}=await import('node:child_process')
    const fs=await import('node:fs/promises'),plugin=load(),terminal=new SSHTabComponent()
    const remote={open:true,ssh:{async openSessionChannel(){return 1},async activateChannel(){
        const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
        return {data$,extendedData$,closed$,async requestExec(command){
            child=spawn('/bin/sh',['-c',command]);child.stdout.on('data',data=>data$.next(data));child.stderr.on('data',data=>extendedData$.next([1,data]));child.on('close',()=>closed$.next())
        },async eof(){child.stdin.end()},async close(){child?.kill()}}
    }},async openSFTP(){return {open:async path=>{
        const file=await fs.open(path,'w');return {write:bytes=>file.write(bytes),close:()=>file.close()}
    },chmod:(path,mode)=>fs.chmod(path,mode)}}}
    terminal.sshSession=remote
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    const prepared=await registry.prepareCwdIntegration(terminal,'bash')
    const script=prepared.command.slice(2).replace(/^'|'$/g,'')
    try{
        assert.ok(prepared.command.length<120);assert.ok(!prepared.command.includes('PROMPT_COMMAND'))
        assert.match(await fs.readFile(script,'utf8'),/PROMPT_COMMAND/)
        assert.equal((await fs.stat(script)).mode&0o777,0o600)
    }finally{await prepared.cleanup()}
    await assert.rejects(fs.access(script))
})

test('SSH without SFTP initializes the directory tree, saves editor changes and stages cwd integration',async()=>{
    const {Subject}=await import('rxjs'),{spawn}=await import('node:child_process')
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-plugin-no-sftp-'))
    const plugin=load(),terminal=new SSHTabComponent(),output=new Subject()
    let probes=0
    terminal.profile={type:'ssh'};terminal.hasFocus=true;terminal.focused$=new Subject();terminal.sessionChanged$=new Subject();terminal.sftpPath='/'
    terminal.session={getWorkingDirectory:async()=>null,oscProcessor:{cwdReported$:new Subject()},destroyed$:new Subject(),output$:output}
    terminal.sshSession={open:true,profile:{options:{host:'no-sftp'}},ssh:{async openSessionChannel(){return {}},async activateChannel(){
        const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
        return {data$,extendedData$,closed$,async requestExec(command){
            child=spawn('/bin/sh',['-c',command],{cwd:root})
            child.stdout.on('data',chunk=>data$.next(chunk));child.stderr.on('data',chunk=>extendedData$.next([1,chunk]));child.on('close',()=>closed$.next())
        },async write(bytes){await new Promise((resolve,reject)=>child.stdin.write(bytes,error=>error?reject(error):resolve()))},async eof(){child.stdin.end()},async close(){child?.kill()}}
    }},async openSFTP(){probes++;throw Error('subsystem request failed')}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    let prepared
    try{
        await fs.mkdir(join(root,'directory'));await fs.writeFile(join(root,'file'),'before')
        registry.register(terminal)
        for(let attempt=0;attempt<100&&!registry.current.value?.workspace;attempt++)await new Promise(resolve=>setTimeout(resolve,10))
        const workspace=registry.current.value?.workspace
        assert.ok(workspace,registry.current.value?.hint)
        assert.equal(workspace.root,root)
        assert.ok((await workspace.list('.')).some(file=>file.name==='directory'&&file.directory))
        const editor=new plugin.EditorComponent({get:()=>({})});editor.setTitle=()=>{}
        editor.workspace=workspace;editor.filePath='file';await editor.ngOnInit()
        assert.equal(editor.error,'');assert.equal(editor.content,'before');assert.equal(editor.readonly,false)
        editor.content='after';await editor.save()
        assert.equal(editor.error,'');assert.equal(await fs.readFile(join(root,'file'),'utf8'),'after')
        prepared=await registry.prepareCwdIntegration(terminal,'bash')
        const script=prepared.command.slice(2).replace(/^'|'$/g,'')
        assert.match(await fs.readFile(script,'utf8'),/PROMPT_COMMAND/)
        assert.equal((await fs.stat(script)).mode&0o777,0o600)
        assert.equal(probes,1)
        await prepared.cleanup();prepared=undefined;await assert.rejects(fs.access(script))
    }finally{registry.unregister(terminal);await prepared?.cleanup();await fs.rm(root,{recursive:true,force:true})}
})

test('remote Git actions and refreshes keep the browsed project, expanded tree and repository state',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs'),{spawn}=await import('node:child_process')
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const home=await fs.mkdtemp(join(tmpdir(),'arw-remote-git-directory-')),project=join(home,'project')
    const plugin=load(),terminal=new SSHTabComponent(),commands=[],relays=[]
    const remote={open:true,profile:{options:{host:'fixture'}},ssh:{async openSessionChannel(){return {}},async activateChannel(){
        const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
        return {data$,extendedData$,closed$,async requestExec(command){
            commands.push(command)
            child=spawn('/bin/sh',['-c',command],{cwd:home})
            child.stdout.on('data',chunk=>data$.next(chunk));child.stderr.on('data',chunk=>extendedData$.next([1,chunk]));child.on('close',()=>closed$.next())
            child.on('error',error=>{extendedData$.next([1,Buffer.from(error.message)]);closed$.next()})
        },async eof(){child.stdin.end()},async close(){child?.kill()}}
    }},async openSFTP(){throw Error('subsystem request failed')}}
    terminal.sshSession=remote
    const workspace={...localWorkspace(home),kind:'remote',host:'fixture'},selection={terminal,remote,workspace,pathSource:'sftp',hint:''}
    const current=new BehaviorSubject(selection)
    const tree=new plugin.TreeComponent({current},{openNewTab(){}},{info(){}},{state(){},disable:async()=>{}},
        {run:async(_tab,workspace,direction)=>relays.push({root:workspace.root,direction})},{},{})
    try{
        await fs.mkdir(join(project,'src'),{recursive:true});await fs.mkdir(join(home,'other'))
        for(const root of [project,join(home,'other')])assert.equal((await localWorkspace(root).run('git init -b main')).exitCode,0)
        await fs.writeFile(join(project,'src/main.ts'),'first')
        await tree.refresh();await tree.open(tree.nodes.find(node=>node.name==='project'))
        await tree.toggle(tree.nodes.find(node=>node.name==='src'))
        const nodes=tree.nodes
        await tree.showGit()
        assert.equal(tree.repositories.length,0)
        await tree.gitStatus()
        assert.deepEqual(Array.from(tree.repositories,entry=>entry.root),[project])
        const repository=tree.repositories[0],scans=()=>commands.filter(command=>command.includes('--show-toplevel')).length
        repository.inspector='history';tree.setCommitMessage(repository,'draft')
        const before=scans()
        await tree.stageChange(repository.groups[1].changes[0],repository)
        await tree.unstageChange(repository.groups[0].changes[0],repository)
        await tree.relay('pull',repository);await tree.relay('push',repository)
        assert.equal(scans(),before)
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,project)
        assert.equal(tree.repositories[0],repository);assert.equal(tree.commitMessage(repository),'draft')
        assert.deepEqual(relays,[{root:project,direction:'pull'},{root:project,direction:'push'}])
        tree.mode='files';await tree.showGit();await tree.showGit()
        assert.equal(scans(),before)
        await tree.refreshCurrentView()
        assert.equal(tree.repositories[0],repository);assert.equal(repository.inspector,'history')
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,project)
        tree.mode='files';await fs.writeFile(join(project,'src/new.ts'),'new');await tree.refresh()
        assert.equal(tree.breadcrumb,project);assert.equal(tree.relativePath,'project')
        assert.equal(tree.nodes.find(node=>node.name==='src').expanded,true)
        assert.ok(tree.nodes.some(node=>node.path==='project/src/new.ts'))
        current.next({...selection,terminal:{},sourceTerminal:terminal})
        assert.equal(tree.breadcrumb,home,'a separate terminal tab sharing the SSH source starts with its own browsing state')
        current.next({terminal:{},workspace:localWorkspace(join(home,'other')),hint:''})
        await tree.refresh()
        current.next(selection)
        assert.equal(tree.breadcrumb,project)
        for(let attempt=0;attempt<50&&tree.loading;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.equal(tree.nodes.find(node=>node.name==='src').expanded,true)
        assert.equal(tree.breadcrumb,project)
        const secondTerminal=new SSHTabComponent();secondTerminal.sshSession=remote
        current.next({...selection,terminal:secondTerminal});await tree.refresh()
        assert.equal(tree.breadcrumb,home,'another SSH tab sharing a transport has its own directory')
        await tree.open(tree.nodes.find(node=>node.name==='other'))
        assert.equal(tree.breadcrumb,join(home,'other'))
        current.next(selection)
        assert.equal(tree.breadcrumb,project,'returning restores the first SSH tab directory')
        const rebound=[]
        tree.projectStore={list:()=>[{id:'saved',name:'project',root:project}],async open(entry,backend,remote){rebound.push(remote)}}
        const replacement={...remote,ssh:remote.ssh}
        current.next({...selection,remote:replacement})
        assert.equal(rebound.length,0,'browsing a remembered directory does not acquire forwarding')
        assert.equal(tree.breadcrumb,project)
        for(let attempt=0;attempt<50&&tree.loading;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
    }finally{tree.ngOnDestroy();await fs.rm(home,{recursive:true,force:true})}
})

test('editing a nested remote file and returning to the SSH tab retains A/B through focus and remounts',async()=>{
    const {Subject}=await import('rxjs'),{spawn}=await import('node:child_process')
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const home=await fs.mkdtemp(join(tmpdir(),'arw-editor-return-')),directory=join(home,'A/B')
    const plugin=load(),activeTabChange$=new Subject(),terminal=new SSHTabComponent(),opened=[]
    terminal.profile={type:'ssh'};terminal.hasFocus=true;terminal.focused$=new Subject();terminal.sessionChanged$=new Subject();terminal.destroyed$=new Subject()
    terminal.session={open:true,getWorkingDirectory:async()=>home,oscProcessor:{cwdReported$:new Subject()},destroyed$:new Subject(),output$:new Subject()}
    terminal.sshSession={open:true,profile:{options:{host:'fixture'}},ssh:{async openSessionChannel(){return {}},async activateChannel(){
        const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
        return {data$,extendedData$,closed$,async requestExec(command){
            child=spawn('/bin/sh',['-c',command],{cwd:home})
            child.stdout.on('data',chunk=>data$.next(chunk));child.stderr.on('data',chunk=>extendedData$.next([1,chunk]));child.on('close',()=>closed$.next())
        },async write(bytes){await new Promise((resolve,reject)=>child.stdin.write(bytes,error=>error?reject(error):resolve()))},async eof(){child.stdin.end()},async close(){child?.kill()}}
    }},async openSFTP(){throw Error('subsystem request failed')}}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$},{run:fn=>fn()})
    const tree=new plugin.TreeComponent(registry,{openNewTab:entry=>opened.push(entry)},{},{state(){},disable:async()=>{}},{},{},{})
    const settle=async()=>{
        for(let attempt=0;attempt<100&&(!tree.selection?.workspace||tree.loading);attempt++)await new Promise(resolve=>setTimeout(resolve,5))
    }
    try{
        await fs.mkdir(directory,{recursive:true});await fs.writeFile(join(directory,'c.txt'),'before')
        registry.register(terminal);await settle()
        await tree.open(tree.nodes.find(node=>node.name==='A'));await tree.open(tree.nodes.find(node=>node.name==='B'))
        await tree.refresh()
        assert.equal(tree.breadcrumb,directory)
        await tree.open(tree.nodes.find(node=>node.name==='c.txt'))
        const editor=new plugin.EditorComponent({get:()=>({})});editor.setTitle=()=>{}
        Object.assign(editor,opened[0].inputs);await editor.ngOnInit()
        assert.equal(editor.content,'before');editor.content='after';await editor.save()
        assert.equal(editor.error,'');assert.equal(await fs.readFile(join(directory,'c.txt'),'utf8'),'after')
        const nodes=tree.nodes
        activeTabChange$.next(editor)
        activeTabChange$.next(terminal);terminal.focused$.next();await settle()
        assert.equal(tree.breadcrumb,directory);assert.equal(tree.nodes,nodes)
        assert.equal(tree.relativePath,'A/B')
        // A decorator may temporarily unregister/re-register a tab while changing its view.
        registry.unregister(terminal);registry.register(terminal)
        activeTabChange$.next(terminal);terminal.focused$.next();await settle()
        assert.equal(tree.breadcrumb,directory)
        assert.equal(tree.nodes.find(node=>node.name==='c.txt').path,'A/B/c.txt')
        assert.equal(registry.current.value.workspace.root,home,'terminal cwd remains separate from the browsed directory')
    }finally{tree.ngOnDestroy();registry.unregister(terminal);await fs.rm(home,{recursive:true,force:true})}
})

// Run the official folder download methods, without mounting its Angular panel.
function nativeSftpDownloadPanel() {
    const ts=require('typescript'),map=JSON.parse(readFileSync(require.resolve('tabby-ssh/dist/index.js.map'),'utf8'))
    const source=map.sourcesContent[map.sources.findIndex(path=>path.endsWith('/components/sftpPanel.component.ts'))]
    const file=ts.createSourceFile('native-sftp.ts',source,ts.ScriptTarget.Latest,true)
    const panel=file.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='SFTPPanelComponent')
    const methods=panel.members.filter(node=>['downloadFolder','calculateFolderSizeAndUpdate','downloadFolderRecursive'].includes(node.name?.getText(file))).map(node=>node.getText(file))
    assert.equal(methods.length,3)
    const compiled=ts.transpileModule(`export class NativePanel {
        constructor(_modal,notifications,platform,_providers){this.notifications=notifications;this.platform=platform}
        ${methods.join('\n')}
    }`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
    const module={exports:{}}
    runInNewContext(compiled,{module,exports:module.exports,console})
    return module.exports.NativePanel
}

test('remote sidebar right-click downloads files and folders through native Tabby SFTP without changing directory',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs'),fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-sidebar-download-')),directory=join(root,'A/B')
    const plugin=load({SSHTabComponent,SFTPPanelComponent:nativeSftpDownloadPanel()}),saved=new Map(),notices=[],dialogs=[],downloads=[]
    const binary=Buffer.alloc(2*1024*1024+1,0x81);binary[0]=0
    let references=0,menu,chooseSave=true,folderTransfer,downloadFailure=false,disconnectDuringDownload=false,lastSink
    const fileSink=name=>{
        const chunks=[];let cancelled=false
        return lastSink={isCancelled:()=>cancelled,cancel(){cancelled=true},async write(bytes){chunks.push(Buffer.from(bytes))},close(){saved.set(name,Buffer.concat(chunks))}}
    }
    let clipboard
    const platform={popupContextMenu(items){menu=items},setClipboard(value){clipboard=value.text},async startDownload(name,mode,size){dialogs.push({name,mode,size});return chooseSave?fileSink(name):null},
        async startDownloadDirectory(name){
            dialogs.push({folder:name});folderTransfer={isCancelled:()=>false,cancel(){},close(){},setTotalSize(){},setStatus(){},setCompleted(value){this.completed=value},
                async createDirectory(path){saved.set(name+'/'+path,'directory')},async createFile(path){return fileSink(name+'/'+path)}}
            return folderTransfer
        }}
    const remote={open:true,willDestroy$:new Subject(),ref(){references++},unref(){references--},profile:{options:{host:'fixture'}},async openSFTP(){return {
        async stat(path){const info=await fs.stat(path);return {name:path.split('/').pop(),fullPath:path,isDirectory:info.isDirectory(),mode:info.mode,size:info.size,modified:info.mtime}},
        async readdir(path){return Promise.all((await fs.readdir(path,{withFileTypes:true})).map(async entry=>{const info=await fs.stat(join(path,entry.name));return {name:entry.name,fullPath:join(path,entry.name),isDirectory:entry.isDirectory(),isSymlink:entry.isSymbolicLink(),mode:info.mode,size:info.size}}))},
        async download(path,transfer){assert.equal(references,1);downloads.push(path);if(downloadFailure)throw Error('fixture download failed');if(disconnectDuringDownload)remote.willDestroy$.next();const content=await fs.readFile(path);for(let offset=0;offset<content.length;offset+=262144)await transfer.write(content.subarray(offset,offset+262144));transfer.close()},
    }}}
    const workspace={...localWorkspace(root),kind:'remote',host:'fixture'}
    const current=new BehaviorSubject({terminal:{},remote,workspace,hint:''})
    const tree=new plugin.TreeComponent({current},{},{error(...args){notices.push(args)},info(){}},{},{},{},platform)
    const event={preventDefault(){},stopPropagation(){}}
    try{
        await fs.mkdir(join(directory,'nested'),{recursive:true});await fs.writeFile(join(directory,'c.bin'),binary);await fs.writeFile(join(directory,'nested/child.txt'),'child')
        await tree.refresh();await tree.open(tree.nodes.find(node=>node.name==='A'));await tree.open(tree.nodes.find(node=>node.name==='B'))
        const nodes=tree.nodes
        tree.showNodeContextMenu(tree.nodes.find(node=>node.name==='c.bin'),event)
        assert.equal(menu[0].enabled,true);assert.match(menu[0].label,/下载/)
        assert.ok(menu.find(item=>item.label==='复制路径'))
        menu.find(item=>item.label==='复制路径').click();assert.equal(clipboard,join(directory,'c.bin'),'copy path resolves remote relative entries against their workspace root')
        await menu[0].click()
        assert.deepEqual(saved.get('c.bin'),binary);assert.equal(dialogs[0].name,'c.bin');assert.equal(dialogs[0].size,binary.length)
        chooseSave=false;await menu[0].click();assert.equal(downloads.length,1);chooseSave=true
        await tree.up()
        const before=tree.nodes,breadcrumb=tree.breadcrumb
        tree.showNodeContextMenu(tree.nodes.find(node=>node.name==='B'),event)
        assert.equal(menu.find(item=>item.label==='添加到工作区').enabled,false)
        menu.find(item=>item.label==='复制路径').click();assert.equal(clipboard,join(root,'A/B'))
        await menu[0].click()
        assert.deepEqual(saved.get('B/c.bin'),binary);assert.equal(saved.get('B/nested'),'directory');assert.equal(saved.get('B/nested/child.txt').toString(),'child')
        assert.equal(folderTransfer.completed,true);assert.equal(tree.nodes,before);assert.equal(tree.breadcrumb,breadcrumb)
        assert.equal(references,0);assert.deepEqual(notices,[])
        downloadFailure=true;await menu[0].click();downloadFailure=false
        assert.equal(notices.length,1,'native directory errors must not be reported twice');notices.length=0
        await tree.open(tree.nodes.find(node=>node.name==='B'))
        tree.showNodeContextMenu(tree.nodes.find(node=>node.name==='c.bin'),event)
        downloadFailure=true;await menu[0].click();downloadFailure=false
        assert.equal(notices.length,1);assert.match(notices[0].join(' '),/fixture download failed/);notices.length=0
        disconnectDuringDownload=true;await menu[0].click();disconnectDuringDownload=false
        assert.equal(lastSink.isCancelled(),true);assert.equal(references,0);assert.deepEqual(notices,[])
        // The open menu retains the original remote session and path if focus changes before click.
        const captured=menu[0]
        current.next({terminal:{},workspace:localWorkspace(root),hint:''})
        await captured.click()
        assert.equal(downloads.at(-1),join(directory,'c.bin'));assert.equal(references,0)
        tree.showNodeContextMenu({name:'local',path:'local',directory:false},event)
        assert.ok(menu.find(item=>item.label==='复制'))
        assert.ok(!menu.some(item=>/下载/.test(item.label)))
        menu.find(item=>item.label==='复制路径').click();assert.equal(clipboard,join(root,'local'))
        for(let attempt=0;attempt<50&&tree.loading;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.match(plugin.TreeComponent.component.template,/\(contextmenu\)="showNodeContextMenu\(node,\$event\)"/)
        assert.ok(nodes.some(node=>node.name==='c.bin'))
    }finally{tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('explorer multiselect confirms batch copy, move, rename and permanent delete',async()=>{
    const plugin=load(),fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{BehaviorSubject}=await import('rxjs')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-explorer-actions-'))
    let menu,response=0
    const dialogs=[],notices=[],workspace=localWorkspace(root),terminal={}
    const current=new BehaviorSubject({terminal,workspace,hint:''})
    const platform={popupContextMenu(items){menu=items},async showMessageBox(options){dialogs.push(options);return {response}}}
    const tree=new plugin.TreeComponent({current},{},{info(...args){notices.push(args)},error(...args){notices.push(args)}},{},{},{},platform)
    const event={preventDefault(){},stopPropagation(){}}
    try{
        await fs.mkdir(join(root,'target'));await fs.mkdir(join(root,'move-target'))
        await fs.writeFile(join(root,'a.txt'),'a');await fs.writeFile(join(root,'b.txt'),'b')
        await tree.refresh()
        const node=name=>tree.nodes.find(item=>item.name===name)
        await tree.clickNode(node('a.txt'),{ctrlKey:true})
        await tree.clickNode(node('b.txt'),{ctrlKey:true})
        assert.deepEqual([...tree.fileSelection.paths],['a.txt','b.txt'])
        tree.showNodeContextMenu(node('a.txt'),event)
        menu.find(item=>item.label==='复制').click()
        tree.showNodeContextMenu(node('target'),event)
        await menu.find(item=>item.label==='粘贴').click()
        await assert.rejects(fs.readFile(join(root,'target/a.txt')),/ENOENT/)
        assert.match(dialogs.at(-1).detail,/a.txt[\s\S]*b.txt[\s\S]*target/)
        response=1;await menu.find(item=>item.label==='粘贴').click()
        assert.equal(await fs.readFile(join(root,'target/b.txt'),'utf8'),'b')
        await tree.clickNode(node('a.txt'),{ctrlKey:true});await tree.clickNode(node('b.txt'),{ctrlKey:true})
        const transfer={types:['application/x-arw-tree-items'],setData(){}}
        tree.startFileDrag(node('a.txt'),{dataTransfer:transfer,preventDefault(){}})
        await tree.dropLocalFiles({...event,dataTransfer:transfer},node('move-target'))
        assert.equal(await fs.readFile(join(root,'move-target/a.txt'),'utf8'),'a')
        await assert.rejects(fs.readFile(join(root,'a.txt')),/ENOENT/)
        tree.renamingPath='move-target';tree.renameValue='renamed'
        await tree.finishRename(node('move-target'))
        assert.equal(await fs.readFile(join(root,'renamed/b.txt'),'utf8'),'b')
        tree.fileSelection.clear();await tree.clickNode(node('renamed'),{ctrlKey:true})
        response=0;await tree.deleteSelected()
        assert.equal(await fs.readFile(join(root,'renamed/a.txt'),'utf8'),'a')
        assert.match(dialogs.at(-1).detail,/永久删除/)
        response=1;await tree.deleteSelected()
        await assert.rejects(fs.stat(join(root,'renamed')),/ENOENT/)
        assert.equal(await fs.readFile(join(root,'target/a.txt'),'utf8'),'a')
        assert.ok(notices.some(args=>args.join(' ').includes('2 项')))
        await fs.writeFile(join(root,'b.txt'),'do not overwrite')
        // Use the bundled clipboard through the menu, then copy both children to the root.
        await tree.open(node('target'))
        await tree.clickNode(node('a.txt'),{ctrlKey:true});await tree.clickNode(node('b.txt'),{ctrlKey:true})
        tree.showNodeContextMenu(node('a.txt'),event);menu.find(item=>item.label==='复制').click()
        await tree.up()
        await tree.fileTreeKey({key:'v',ctrlKey:true,...event})
        assert.equal(await fs.readFile(join(root,'a.txt'),'utf8'),'a')
        assert.equal(await fs.readFile(join(root,'b.txt'),'utf8'),'do not overwrite')
        assert.ok(notices.some(args=>args.join(' ').includes('1/2')),'partial failures report the completed item count')
    }finally{tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true,maxRetries:5})}
})

test('explorer scroll is restored independently for each workspace and directory',async()=>{
    const elements={tree:{scrollTop:0}},document={querySelector(selector){return selector.endsWith('.file-tree')?elements.tree:null}}
    const plugin=load(undefined,{document}),Tree=plugin.TreeComponent
    const {BehaviorSubject}=await import('rxjs')
    const first={id:'one',kind:'local',host:'localhost',root:'/one',async list(){return []}},second={...first,id:'two',root:'/two'}
    const current=new BehaviorSubject({terminal:{},workspace:first,hint:''})
    const tree=new Tree({current},{},{info(){},error(){}},{},{},{},{})
    try{
        await tree.refresh();tree.activeTab={};tree.viewReady=true
        tree.fileScrollRestoring=false;tree.rememberFileScroll({target:{scrollTop:320}})
        await tree.showWorkspace(second)
        await new Promise(resolve=>setTimeout(resolve,10))
        assert.equal(elements.tree.scrollTop,0)
        tree.rememberFileScroll({target:{scrollTop:680}})
        await tree.showWorkspace(first)
        await new Promise(resolve=>setTimeout(resolve,10))
        assert.equal(elements.tree.scrollTop,320)
        await tree.showWorkspace(second)
        await new Promise(resolve=>setTimeout(resolve,10))
        assert.equal(elements.tree.scrollTop,680)
        tree.relativePath='nested';tree.restoreFileScroll()
        await new Promise(resolve=>setTimeout(resolve,10))
        assert.equal(elements.tree.scrollTop,0)
    }finally{tree.ngOnDestroy()}
})

test('late pwd responses and cwd detection cannot overwrite an explicitly browsed directory',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    let resolvePwd
    const terminal={session:{getWorkingDirectory:()=>new Promise(resolve=>{resolvePwd=resolve})}}
    const workspace={id:'memory',kind:'local',root:'/home/user',host:'localhost',label:'home',async list(path){
        if(path==='.')return [{name:'A',path:'A',directory:true,symlink:false}]
        if(path==='A')return [{name:'B',path:'A/B',directory:true,symlink:false}]
        return [{name:'c.txt',path:'A/B/c.txt',directory:false,symlink:false}]
    }}
    const current=new BehaviorSubject({terminal,workspace,hint:''})
    const tree=new plugin.TreeComponent({current},{openNewTab(){}},{},{},{},{},{})
    try{
        await tree.refresh()
        const pending=tree.followTerminal()
        await tree.open(tree.nodes[0]);await tree.open(tree.nodes[0])
        resolvePwd('/home/user');await pending
        assert.equal(tree.breadcrumb,'/home/user/A/B')
        tree.cwdSetupPending=true
        current.next({terminal,workspace:{...workspace,root:'/home/other'},pathSource:'terminal',hint:''})
        assert.equal(tree.cwdSetupPending,false)
        assert.equal(tree.breadcrumb,'/home/user/A/B')
        const nodes=tree.nodes
        await tree.toggleTerminalMode();await tree.toggleTerminalMode()
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,'/home/user/A/B')
    }finally{tree.ngOnDestroy()}
})

test('Git scans start in the background without opening Git and cancellation keeps partial results', {timeout:5000},async()=>{
    const {BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),root=await fs.mkdtemp(join(tmpdir(),'arw-background-git-'))
    const base=localWorkspace(root),plugin=load(),terminal={}
    let commands=0,block=false,release,scanSignal
    const workspace={...base,listForGit:undefined,async runGit(...args){
        commands++
        if(block){scanSignal=args[1];return new Promise(resolve=>{release=()=>resolve({exitCode:0,stdout:root+'\n',stderr:''})})}
        return base.runGit(...args)
    },async list(path,signal){
        return base.list(path,signal)
    }}
    assert.equal((await base.run('git init -b main')).exitCode,0)
    const current=new BehaviorSubject({terminal,workspace,hint:''})
    const tree=new plugin.TreeComponent({current},{},{},{},{},{},{})
    try{
        await tree.refresh();await tree.gitScan
        assert.equal(tree.mode,'files')
        assert.ok(commands>0,'discovery starts before opening the Git view')
        assert.equal(tree.repositories[0].root,root)
        current.next({terminal:{},workspace,hint:''});await tree.refresh()
        await tree.gitScan
        current.next({terminal,workspace,hint:''});await tree.refresh()
        for(let attempt=0;attempt<100&&tree.repositories[0].loading;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
        tree.showGit()
        const nodes=tree.nodes,breadcrumb=tree.breadcrumb
        block=true
        const pending=tree.gitStatus()
        for(let attempt=0;attempt<100&&!release;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.ok(release);assert.equal(tree.gitLoading,true);assert.equal(tree.repositories.length,1)
        const repository=tree.repositories[0]
        assert.equal(scanSignal.aborted,false)
        const before=commands
        assert.equal(tree.gitStatus(),pending,'concurrent callers share the scan')
        assert.equal(commands,before,'another refresh cannot start a concurrent scan')
        tree.cancelGitScan()
        assert.equal(scanSignal.aborted,true);assert.equal(tree.gitLoading,false)
        assert.equal(tree.repositories[0],repository);assert.equal(repository.loading,false)
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,breadcrumb)
        assert.match(tree.gitNotice,/已取消/);assert.equal(tree.error,'')
        await pending // The native Git probe has deliberately not completed yet.
        block=false;release();await new Promise(resolve=>setImmediate(resolve))
        assert.equal(tree.repositories[0],repository);assert.equal(tree.error,'');assert.match(tree.gitNotice,/已取消/)
        await tree.refreshCurrentView()
        assert.equal(tree.repositories[0],repository);assert.equal(tree.gitLoading,false)
        assert.doesNotMatch(tree.gitNotice,/已取消/)
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,breadcrumb)
        assert.match(plugin.TreeComponent.component.template,/\(click\)="cancelGitScan\(\)"/)
        assert.match(plugin.TreeComponent.component.template,/\[attr\.aria-label\]="'取消 Git 扫描' \| arwTranslate"/)
    }finally{block=false;release?.([]);tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('deleting local Git metadata offers initialization and cloning without an SSH session',async()=>{
    const {BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),{localGitRunner}=require('../.build/arw-tree/git/local-git-push.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-local-git-setup-')),git=localGitRunner(),plugin=load()
    await git(['init','-b','main',root])
    const workspace=localWorkspace(root),tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal:{},workspace,hint:''})},{},{},{},{},{},{})
    try{
        await tree.refresh();await tree.showGit();await tree.autoFetch;await tree.gitStatus()
        assert.equal(tree.canSetupGit,false)
        await fs.rm(join(root,'.git'),{recursive:true,force:true})
        await tree.gitStatus()
        assert.equal(tree.repositories.length,0);assert.equal(tree.canSetupGit,true)
        tree.openGitSetup('clone');assert.equal(tree.gitSetupMode,'clone');tree.closeGitSetup()
        tree.openGitSetup('init')
        tree.gitSetupName='Local User';tree.gitSetupEmail='local@example.test';tree.gitSetupUrl='https://example.test/team/project.git'
        await tree.submitGitSetup()
        assert.equal(tree.gitSetupError,'');assert.equal(tree.gitSetupMode,null)
        assert.equal(tree.repositories[0].workspace.kind,'local')
        assert.equal((await git(['-C',root,'config','--local','user.name'])).trim(),'Local User')
        assert.equal(tree.breadcrumb,root)
    }finally{tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('an empty Git scan offers remote initialization and local-relay cloning with repository identity',async()=>{
    const {BehaviorSubject,Subject}=await import('rxjs'),{spawn}=await import('node:child_process')
    const fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),{localGitRunner}=require('../.build/arw-tree/git/local-git-push.js')
    const {cloneThroughLocalGit}=require('../.build/arw-tree/git/git-bootstrap.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-git-create-ui-')),git=localGitRunner(),plugin=load(),trees=[],clones=[]
    const url='https://example.test/team/project.git',upstream=join(root,'upstream.git'),seed=join(root,'seed')
    const create=async(name,tasks={})=>{
        const directory=join(root,name);await fs.mkdir(directory)
        const terminal=new SSHTabComponent();let refs=0
        const remote={open:true,profile:{options:{host:'fixture'}},ref(){refs++},unref(){refs--},willDestroy$:new Subject(),ssh:{async openSessionChannel(){return {}},async activateChannel(){
            const data$=new Subject(),extendedData$=new Subject(),closed$=new Subject();let child
            return {data$,extendedData$,closed$,async requestExec(command){child=spawn('/bin/sh',['-c',command],{cwd:directory});child.stdout.on('data',chunk=>data$.next(chunk));child.stderr.on('data',chunk=>extendedData$.next([1,chunk]));child.on('close',()=>closed$.next())},async eof(){child.stdin.end()},async close(){child?.kill()}}
        }}}
        terminal.sshSession=remote
        const workspace={...localWorkspace(directory),kind:'remote',host:'fixture'}
        const tree=new plugin.TreeComponent({current:new BehaviorSubject({terminal,remote,workspace,hint:''})},{},{},{state(){},disable:async()=>{}},tasks,{},{})
        trees.push(tree);await tree.refresh();await tree.showGit()
        assert.equal(tree.canSetupGit,false,'creation actions must wait for a completed empty scan')
        await tree.gitStatus();assert.equal(tree.canSetupGit,true)
        return {tree,directory,refs:()=>refs}
    }
    const fill=tree=>{tree.gitSetupName='Remote User';tree.gitSetupEmail='remote@example.test';tree.gitSetupUrl=url}
    try{
        const initialized=await create('init')
        await fs.writeFile(join(initialized.directory,'existing'),'keep')
        const nodes=initialized.tree.nodes
        initialized.tree.openGitSetup('init');await initialized.tree.submitGitSetup()
        assert.match(initialized.tree.gitSetupError,/用户名/)
        await assert.rejects(fs.access(join(initialized.directory,'.git')))
        fill(initialized.tree);await initialized.tree.submitGitSetup()
        assert.equal(initialized.tree.gitSetupError,'');assert.equal(initialized.tree.gitSetupMode,null)
        assert.equal(initialized.tree.breadcrumb,initialized.directory);assert.equal(initialized.tree.nodes,nodes)
        assert.equal(initialized.tree.repositories[0].root,initialized.directory);assert.equal(initialized.tree.repositories[0].branch,'main')
        assert.equal((await git(['-C',initialized.directory,'config','--local','user.email'])).trim(),'remote@example.test')
        assert.equal((await git(['-C',initialized.directory,'remote','get-url','origin'])).trim(),url)
        assert.equal(await fs.readFile(join(initialized.directory,'existing'),'utf8'),'keep');assert.equal(initialized.refs(),0)
        await git(['init','--bare','-b','main',upstream]);await git(['clone',upstream,seed])
        await git(['-C',seed,'config','user.name','Seed']);await git(['-C',seed,'config','user.email','seed@example.test'])
        await fs.writeFile(join(seed,'README.md'),'cloned');await git(['-C',seed,'add','.']);await git(['-C',seed,'commit','-m','initial']);await git(['-C',seed,'push','origin','main'])
        const cloned=await create('clone',{async clone(tab,workspace,input,signal){
            clones.push({tab,workspace,input})
            const backend=localWorkspace(workspace.root)
            return cloneThroughLocalGit({root:workspace.root,run:(command,signal)=>backend.run(command,signal),upload:(source,target)=>fs.copyFile(source,target),remove:path=>fs.rm(path,{force:true})},input,
                {storagePath:join(root,'cache'),signal,local:(args,signal,report)=>git(args.map(value=>value===url?upstream:value),signal,report)})
        }})
        cloned.tree.openGitSetup('clone');fill(cloned.tree);cloned.tree.gitSetupDirectory='project'
        await cloned.tree.submitGitSetup()
        assert.equal(cloned.tree.gitSetupError,'');assert.equal(clones.length,1)
        assert.equal(clones[0].workspace.root,cloned.directory)
        assert.equal(cloned.tree.breadcrumb,cloned.directory)
        assert.equal(cloned.tree.repositories[0].root,join(cloned.directory,'project'))
        assert.equal(await fs.readFile(join(cloned.directory,'project/README.md'),'utf8'),'cloned');assert.equal(cloned.refs(),0)
        const cancelled=await create('cancel',{clone:async(_tab,_workspace,_input,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
        cancelled.tree.openGitSetup('clone');fill(cancelled.tree)
        const pending=cancelled.tree.submitGitSetup();assert.equal(cancelled.tree.gitSetupBusy,true)
        cancelled.tree.cancelGitSetup();await pending
        assert.equal(cancelled.tree.gitSetupBusy,false);assert.match(cancelled.tree.gitSetupError,/已取消/);assert.equal(cancelled.refs(),0)
        assert.match(plugin.TreeComponent.component.template,/初始化 Git/);assert.match(plugin.TreeComponent.component.template,/克隆 Git 项目/)
        assert.match(plugin.TreeComponent.component.template,/name="gitUser"/);assert.match(plugin.TreeComponent.component.template,/name="gitEmail"/);assert.match(plugin.TreeComponent.component.template,/name="gitUrl"/)
    }finally{for(const tree of trees)tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('file previews keep the original backend, navigate images, render Markdown and paginate CSV without changing the sidebar',async()=>{
    const {BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),root=await fs.mkdtemp(join(tmpdir(),'arw-preview-ui-'))
    const plugin=load(),opened=[],external=[],api={detectChanges(){},openNewTab:entry=>opened.push(entry),openExternal:url=>external.push(url)}
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKuAAAAAASUVORK5CYII=','base64')
    const workspace=localWorkspace(root),current=new BehaviorSubject({terminal:{},workspace,hint:''})
    const tree=new plugin.TreeComponent({current},api,{},{},{},{},{})
    const previews=[]
    try{
        await fs.mkdir(join(root,'nested'));await fs.writeFile(join(root,'first.png'),png);await fs.writeFile(join(root,'second.PNG'),png)
        await fs.writeFile(join(root,'nested/unrelated.png'),png)
        await fs.writeFile(join(root,'README.md'),'# Title\n\n**bold**\n\n![local](first.png)\n\n![external](https://example.test/track.png)\n\n<script>bad()</script>')
        await fs.writeFile(join(root,'table.csv'),'name,value\n'+Array.from({length:205},(_,index)=>`row${index},${index}`).join('\n'))
        await fs.writeFile(join(root,'main.ts'),'code')
        await tree.refresh();const nodes=tree.nodes,breadcrumb=tree.breadcrumb
        await tree.open(tree.nodes.find(node=>node.name==='first.png'))
        assert.equal(opened[0].type,plugin.PreviewComponent)
        assert.deepEqual(Array.from(opened[0].inputs.imagePaths),['first.png','second.PNG'])
        const image=new plugin.PreviewComponent({get:()=>api});image.setTitle=()=>{};Object.assign(image,opened[0].inputs);previews.push(image)
        await image.ngOnInit();assert.equal(image.error,'');assert.ok(image.imageUrl.startsWith('blob:'))
        const first=image.imageUrl;await image.changeImage(1)
        assert.equal(image.filePath,'second.PNG');assert.notEqual(image.imageUrl,first)
        await assert.rejects(fetch(first),'old image object URLs must be revoked')
        assert.equal(tree.nodes,nodes);assert.equal(tree.breadcrumb,breadcrumb)
        await tree.open(tree.nodes.find(node=>node.name==='README.md'))
        const markdown=new plugin.PreviewComponent({get:()=>api});markdown.setTitle=()=>{};Object.assign(markdown,opened.at(-1).inputs);previews.push(markdown)
        await markdown.ngOnInit();assert.equal(markdown.error,'');assert.match(markdown.markdown,/<strong>bold<\/strong>/)
        assert.match(markdown.markdown,/data:image\/png;base64,/);assert.doesNotMatch(markdown.markdown,/<script|<img[^>]+https:/)
        markdown.edit();assert.equal(opened.at(-1).type,plugin.EditorComponent);assert.equal(opened.at(-1).inputs.workspace,workspace)
        await tree.open(tree.nodes.find(node=>node.name==='table.csv'))
        const csv=new plugin.PreviewComponent({get:()=>api});csv.setTitle=()=>{};Object.assign(csv,opened.at(-1).inputs);previews.push(csv)
        await csv.ngOnInit();assert.equal(csv.error,'');assert.equal(csv.csvFiltered.length,205);assert.equal(csv.csvPages,3)
        assert.equal(csv.csvPageRows.length,100);csv.changeCsvPage(2);assert.equal(csv.csvPageRows.length,5)
        csv.csvQuery='row204';csv.filterTable();assert.equal(csv.csvFiltered.length,1);assert.equal(csv.csvPage,1)
        assert.equal(csv.csvPageRows[0].values[0],'row204')
        await tree.open(tree.nodes.find(node=>node.name==='main.ts'));assert.equal(opened.at(-1).type,plugin.EditorComponent)
        assert.equal(tree.breadcrumb,breadcrumb);assert.equal(external.length,0)
        const final=image.imageUrl;image.ngOnDestroy();previews.splice(previews.indexOf(image),1)
        await assert.rejects(fetch(final))
    }finally{for(const preview of previews)preview.ngOnDestroy();tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('saved forwarding replaces an obsolete SSH session even when its open flag remains true',async()=>{
    const {Subject}=await import('rxjs'),fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os')
    const directory=await fs.mkdtemp(join(tmpdir(),'arw-stale-session-')),plugin=load()
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory({store:{omw:{projects:{}}},async save(){}},{getConfigPath:()=>join(directory,'config.yaml')})
    const context={kind:'remote',host:JSON.stringify(['fixture',22,'user'])},project=await store.add(context,'/project')
    const owner=()=>({open:true,ssh:{},willDestroy$:new Subject(),refs:0,ref(){this.refs++},unref(){this.refs--}})
    const old=owner(),current=owner(),source={sshSession:old},backend=content=>({...context,root:project.root,read:async()=>{if(content==='obsolete')throw Error('SendError');return {content}},list:async()=>[],write:async()=>({}),run:async()=>({exitCode:0,stdout:'/project\n/project/result.out\n',stderr:''})})
    const read=async()=>{const config=JSON.parse(await fs.readFile(store.connection(project.id),'utf8'));return (await(await ipcFetch(config,{method:'POST',body:JSON.stringify({name:'remote_read',arguments:{workspaceId:project.id,path:'result.out'}})})).json()).result}
    try{
        await store.open(project,backend('obsolete'),old,source)
        assert.match((await read()).message,/SendError/)
        const {BehaviorSubject}=await import('rxjs')
        const activityTree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{})
        try {
            activityTree.selection={terminal:source,remote:old}
            assert.equal(activityTree.activities.length,1)
            assert.equal(activityTree.activities[0].workspaceId,project.id)
            activityTree.selection={terminal:{sshSession:old},remote:old}
            assert.equal(activityTree.activities.length,0,'even terminals sharing the same SSH session have separate histories')
            const sibling={}
            activityTree.app.getParentTab=tab=>tab===sibling?{getAllTabs:()=>[source,sibling]}:undefined
            activityTree.selection={terminal:sibling,remote:old}
            assert.equal(activityTree.activities.length,1,'same top-level tab merges activity across terminal panes')
            activityTree.selection={terminal:{},workspace:{kind:'local'}}
            assert.equal(activityTree.activities.length,0)
            activityTree.selection={terminal:{},sourceTerminal:source,remote:old}
            assert.equal(activityTree.activities.length,1,'AI panes follow their original remote terminal')
        }finally{activityTree.ngOnDestroy()}
        const obsolete=store.connection(project.id)
        assert.equal(store.connection(project.id,source),obsolete)
        assert.equal(store.connection(project.id,{sshSession:old}),undefined)
        const another=owner()
        await store.open(project,backend('another terminal'),another,{sshSession:another})
        assert.equal(store.connection(project.id),obsolete,'switching to another healthy terminal must not interrupt an active forward')
        assert.equal(another.refs,0)
        source.sshSession=current
        await store.open(project,backend('current'),current,source)
        assert.equal(old.open,true);assert.equal(old.refs,0);assert.equal(current.refs,1)
        await assert.rejects(fs.access(obsolete))
        assert.equal((await read()).content,'current')
        old.willDestroy$.next();assert.ok(store.connection(project.id))
        current.ssh={}
        await store.open(project,backend('rotated client'),current,source)
        assert.equal((await read()).content,'rotated client');assert.equal(current.refs,1)
        current.ssh={}
        const pending=store.open(project,backend('shutdown race'),current,source)
        await store.ngOnDestroy();await pending
        assert.equal(store.connection(project.id),undefined);assert.equal(current.refs,0)
    }finally{await store.ngOnDestroy();await fs.rm(directory,{recursive:true,force:true})}
})

test('a pinned AI tab follows the source terminal replacement SSH session while keeping its project root',async()=>{
    const {Subject}=await import('rxjs'),plugin=load(),source=new SSHTabComponent()
    const old={open:true,profile:{options:{host:'fixture',user:'alice'}}},current={open:true,profile:{options:{host:'fixture',user:'alice'}}}
    source.sshSession=old
    const ai={profile:{type:'local'},focused$:new Subject(),sessionChanged$:new Subject(),destroyed$:new Subject()}
    const registry=new plugin.WorkspaceRegistry({activeTabChange$:new Subject()},{run:fn=>fn()})
    try{
        registry.pin(ai,{terminal:source,remote:old,workspace:{id:'saved-id',kind:'remote',host:'fixture',root:'/A/B'},hint:''})
        source.sshSession=current;registry.activate(ai)
        assert.equal(registry.get(ai).remote,current)
        assert.equal(registry.get(ai).workspace.root,'/A/B');assert.equal(registry.get(ai).workspace.id,'saved-id')
        current.open=false;registry.activate(ai)
        assert.equal(registry.get(ai).workspace,undefined)
        current.open=true;registry.activate(ai)
        assert.equal(registry.get(ai).workspace.root,'/A/B')
        assert.equal(registry.get(ai).remote,current)
    }finally{registry.unregister(ai)}
})

test('workspace forwarding indicators follow startup, request failures, recovery and disconnect with redacted logs',async()=>{
    const {Subject,BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os')
    const directory=await fs.mkdtemp(join(tmpdir(),'arw-forwarding-state-')),plugin=load()
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory({store:{omw:{projects:{}}},async save(){}},{getConfigPath:()=>join(directory,'config.yaml')})
    const context={kind:'remote',host:JSON.stringify(['fixture',22,'user'])},project=await store.add(context,'/project'),events=[]
    const remote={open:true,ssh:{},willDestroy$:new Subject(),ref(){},unref(){}}
    let fail=true,renders=0
    const observation=store.changed.subscribe(()=>events.push(store.state(project.id).phase))
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{},store,{detectChanges(){renders++}})
    tree.viewReady=true
    const backend={kind:'remote',host:'fixture',root:'/project',list:async()=>[],read:async()=>{if(fail)throw Error('SendError token=private-secret');return {content:'recovered'}},write:async()=>({}),run:async command=>command.includes('realpath')?{stdout:'/project\n/project/file\n',stderr:'',exitCode:0}:{stdout:'',stderr:'',exitCode:7}}
    try{
        tree.selection={workspace:backend,remote}
        assert.equal(store.state(project.id).phase,'saved')
        await store.open(project,backend,remote)
        assert.ok(events.includes('starting'));assert.equal(tree.projectForwarding(project),'forwarding')
        const connection=JSON.parse(await fs.readFile(store.connection(project.id),'utf8'))
        const request=async(name,args={})=>(await(await ipcFetch(connection,{body:JSON.stringify({name,arguments:{workspaceId:project.id,...args}})})).json()).result
        for(let i=0;i<6;i++)await request('remote_read',{path:'file'})
        assert.equal(tree.projectForwarding(project),'error');assert.equal(store.state(project.id).logs.length,5)
        assert.match(tree.projectForwardingTitle(project),/SendError/)
        assert.doesNotMatch(tree.projectForwardingTitle(project),/private-secret/)
        assert.match(tree.projectForwardingTitle(project),/remote_read/)
        await request('list_remote_workspaces');assert.equal(tree.projectForwarding(project),'error')
        await request('arw_cli_batch',{operations:[{command:'read',arguments:{path:'file'}}]});assert.equal(tree.projectForwarding(project),'error')
        await request('run_remote_command',{command:'sudo true'});assert.equal(tree.projectForwarding(project),'error')
        fail=false;assert.equal((await request('remote_read',{path:'file'})).content,'recovered')
        assert.equal(tree.projectForwarding(project),'forwarding')
        assert.equal((await request('run_remote_command',{command:'false'})).exitCode,7)
        assert.equal(tree.projectForwarding(project),'forwarding','a command exit code is not a transport failure')
        remote.open=false;remote.willDestroy$.next()
        assert.equal(tree.projectForwarding(project),'error');assert.match(tree.projectForwardingTitle(project),/SSH 连接已断开/)
        assert.ok(renders>0,'status events must repaint without refreshing the file tree')
        const failed=await store.add(context,'/failed')
        await assert.rejects(store.open(failed,{...backend,root:'/failed'}, {...remote,open:true,ref(){throw Error('Cannot start password=private-password')}}))
        assert.equal(store.state(failed.id).phase,'error')
        assert.doesNotMatch(tree.projectForwardingTitle(failed),/private-password/)
        assert.match(plugin.TreeComponent.component.template,/forwarding-active/)
        assert.match(plugin.TreeComponent.component.template,/forwarding-failed/)
    }finally{observation.unsubscribe();tree.ngOnDestroy();await store.ngOnDestroy();await fs.rm(directory,{recursive:true,force:true})}
})

test('commit badges record successful synchronization but never failed remote relay operations',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{})
    const old='a'.repeat(40),upstream='b'.repeat(40),incoming='c'.repeat(40)
    let head=old
    const repository={commits:[]}
    tree.git=()=>({
        probe:async args=>args.includes(`${'refs/remotes/origin/main'}^{commit}`)?upstream:head,
        batch:async()=>[{exitCode:0,stdout:'main\n',stderr:''},{exitCode:0,stdout:head,stderr:''}],
        run:async args=>args[0]==='for-each-ref'?'refs/remotes/origin/main\n':args.includes('--left-right')?'1\t0\n':args[1]==='HEAD'?`${incoming}\n`:`${old}\n`,
    })
    try{
        await assert.rejects(tree.recordGitSync(repository,'push',async()=>false),/中继未完成/)
        assert.equal(repository.pushedCommits,undefined)
        await tree.recordGitSync(repository,'push',async()=>true)
        assert.equal(repository.pushedCommits.has(old),true)
        await tree.recordGitSync(repository,'pull',async()=>{head=incoming;return true})
        assert.equal(repository.pulledCommits.has(incoming),true)
        assert.equal(tree.commitSyncLabel({syncStatus:'pushed'}),'已推送')
        assert.equal(tree.commitSyncLabel({syncStatus:'pulled'}),'已拉取')
        assert.equal(tree.commitSyncLabel({syncStatus:'synced'}),'已在上游')
        assert.equal(tree.commitSyncLabel({syncStatus:'incoming'}),'待拉取')
        assert.match(plugin.TreeComponent.component.template,/commitSyncLabel\(commit\)/)
        assert.match(plugin.TreeComponent.component.template,/class="commit-sync"/)
    }finally{tree.ngOnDestroy()}
})

test('sidebar errors can be dismissed without restoring cached errors or clearing unrelated state',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load(),current=new BehaviorSubject(null)
    const tree=new plugin.TreeComponent({current},{},{},{},{},{},{})
    try{
        const terminal={},other={},workspace={kind:'local',root:'/fixture',label:'fixture',list:async()=>[],run:async()=>({stdout:'',stderr:'not a git repository',exitCode:128})}
        current.next({terminal,workspace,hint:''});await tree.refresh();await tree.gitScan
        tree.error='git: command not found';tree.gitSetupError='setup failure';tree.cwdSetupError='cwd failure'
        tree.filterText='keep filter'
        const repository={root:'/fixture',error:'push failure',inspectorError:'history failure',message:'keep message'}
        tree.repositories=[repository];tree.gitNoticeByRoot.set(repository.root,{error:repository.error,message:'keep notice'})
        tree.dismissError()
        assert.equal(tree.error,'');assert.equal(tree.gitSetupError,'setup failure');assert.equal(tree.filterText,'keep filter')
        tree.dismissError('gitSetupError');tree.dismissError('cwdSetupError')
        assert.equal(tree.gitSetupError,'');assert.equal(tree.cwdSetupError,'')
        tree.dismissRepositoryError(repository)
        assert.equal(repository.error,'');assert.equal(repository.inspectorError,'history failure')
        assert.equal(tree.gitNoticeByRoot.get(repository.root).error,'')
        assert.equal(tree.gitNoticeByRoot.get(repository.root).message,'keep notice')
        tree.dismissRepositoryError(repository,'inspectorError')
        assert.equal(repository.inspectorError,'');assert.equal(repository.message,'keep message')
        tree.repositories=[]
        current.next({terminal:other,workspace,hint:''});await tree.refresh();await tree.gitScan
        current.next({terminal,workspace,hint:''})
        assert.equal(tree.error,'');assert.equal(tree.gitSetupError,'')
        assert.equal(tree.gitNoticeByRoot.get('/fixture').error,'')
        tree.error='new failure';assert.equal(tree.error,'new failure','new failures are not permanently hidden')
        const template=plugin.TreeComponent.component.template
        assert.equal((template.match(/class="icon-button dismiss-error"/g)||[]).length,5)
        assert.match(template,/\[attr\.aria-label\]="'关闭错误提示' \| arwTranslate"/)
    }finally{tree.ngOnDestroy()}
})

test('split panes share their top-level sidebar state and focus changes do not cancel Git discovery',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const source={},agent={},other={},split={},wrapper={}
    const parents=new Map([[source,split],[agent,wrapper],[wrapper,split]])
    let finishProbe,probes=0
    const workspace={kind:'local',root:'/fixture',label:'fixture',list:async()=>[],run:async()=>{
        probes++
        return new Promise(resolve=>{finishProbe=resolve})
    }}
    const current=new BehaviorSubject({terminal:source,workspace,hint:''})
    const tree=new plugin.TreeComponent({current},{getParentTab:tab=>parents.get(tab)},{},{},{},{},{})
    try{
        await tree.refresh()
        assert.equal(probes,1)
        tree.setMode('git');tree.filterText='draft';tree.projectsExpanded=false
        tree.activityCategory='write';tree.commitMessages.set('fixture','commit draft')
        const nodes=tree.nodes
        current.next({terminal:agent,sourceTerminal:source,workspace,hint:''})
        assert.equal(tree.mode,'git');assert.equal(tree.filterText,'draft')
        assert.equal(tree.projectsExpanded,false);assert.equal(tree.activityCategory,'write')
        assert.equal(tree.commitMessages.get('fixture'),'commit draft')
        assert.equal(tree.nodes,nodes);assert.equal(tree.selection.terminal,agent)
        assert.equal(probes,1,'focusing a split must not start another scan')
        finishProbe({stdout:'',stderr:'not a git repository',exitCode:128})
        await tree.gitScan
        assert.equal(tree.gitLoading,false)
        assert.equal(tree.gitScanCompleted,true,'the pending scan survives split focus changes')
        current.next({terminal:other,workspace:{...workspace,root:'/other'},hint:''})
        await tree.refresh()
        assert.equal(tree.mode,'files')
        current.next({terminal:source,workspace,hint:''})
        assert.equal(tree.mode,'git');assert.equal(tree.filterText,'draft')
        assert.equal(tree.commitMessages.get('fixture'),'commit draft')
        current.next({terminal:agent,sourceTerminal:source,workspace,hint:''})
        assert.equal(tree.mode,'git');assert.equal(tree.nodes,nodes)
    }finally{
        tree.ngOnDestroy()
        finishProbe?.({stdout:'',stderr:'not a git repository',exitCode:128})
    }
})

test('each terminal tab restores its complete sidebar state without refreshing cached files or Git',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),current=new BehaviorSubject(null),ssh={},left={},right={}
    const listCalls=[]
    let leftFiles=[{name:'old.txt',path:'old.txt',directory:false,symlink:false}]
    const rightFiles=[{name:'right.txt',path:'right.txt',directory:false,symlink:false}]
    let listError=false
    const make=(root,getFiles)=>({kind:'remote',host:'fixture',root,label:root,list:async()=>{
        listCalls.push(root);if(listError)throw Error('directory unavailable');return getFiles()
    }})
    const leftWorkspace=make('/remote/a',()=>leftFiles),rightWorkspace=make('/remote/b',()=>rightFiles)
    const tree=new plugin.TreeComponent({current},{},{info(){}},{disable:async()=>{}},{run:async()=>{}},{},{})
    tree.loadGitInspector=async()=>{}
    let gitError=false
    tree.git=()=>({status:async()=>{
        if(gitError)throw Error('remote Git unavailable')
        return [{path:'new.txt',index:' ',working:'M'}]
    }})
    const waitFor=async(predicate,message)=>{
        for(let attempt=0;attempt<100&&!predicate();attempt++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.ok(predicate(),message)
    }
    try{
        current.next({terminal:left,sourceTerminal:ssh,workspace:leftWorkspace,hint:''})
        await tree.refresh()
        tree.setMode('git')
        const repository={workspace:leftWorkspace,root:'/remote/a/project',name:'project',expanded:true,
            groups:[{title:'已暂存',staged:true,changes:[]},{title:'工作区',staged:false,changes:[]}],error:'',count:0,loading:false,
            branch:'',branches:[],commits:[],inspector:'history',inspectorLoading:false,inspectorError:''}
        tree.repositories=[repository];tree.gitScope=tree.currentGitScope();tree.gitScanCompleted=true
        tree.setCommitMessage(repository,'left draft')
        tree.filterText='left';tree.directoryDraft='/remote/a/dr';tree.projectsExpanded=false;tree.terminalMode=true
        tree.activityCategory='write';tree.activityStatus='error';tree.error='left error';tree.gitSetupMode='init';tree.gitSetupError='setup error'
        tree.viewScroll={savedWorkspaces:12,browser:34,footer:5}

        current.next({terminal:right,sourceTerminal:ssh,workspace:rightWorkspace,hint:''})
        await tree.refresh()
        assert.equal(tree.breadcrumb,'/remote/b')
        assert.equal(tree.mode,'files')
        assert.equal(tree.commitMessage(repository),'')
        assert.equal(tree.directoryInput,'/remote/b')
        assert.equal(tree.projectsExpanded,true)
        assert.equal(tree.terminalMode,false)
        assert.equal(tree.activityCategory,'all')
        assert.equal(tree.gitSetupMode,null)

        leftFiles=[...leftFiles,{name:'new.txt',path:'new.txt',directory:false,symlink:false}]
        listCalls.length=0
        current.next({terminal:left,sourceTerminal:ssh,workspace:leftWorkspace,hint:''})
        assert.equal(tree.breadcrumb,'/remote/a')
        assert.equal(tree.mode,'git')
        assert.equal(tree.commitMessage(tree.repositories[0]),'left draft')
        assert.equal(tree.filterText,'left')
        assert.equal(tree.directoryInput,'/remote/a/dr')
        assert.equal(tree.projectsExpanded,false)
        assert.equal(tree.terminalMode,true)
        assert.equal(tree.activityCategory,'write')
        assert.equal(tree.activityStatus,'error')
        assert.equal(tree.error,'left error')
        assert.equal(tree.gitSetupMode,'init')
        assert.equal(tree.gitSetupError,'setup error')
        assert.equal(tree.viewScroll.savedWorkspaces,12)
        assert.equal(tree.viewScroll.browser,34)
        assert.equal(tree.viewScroll.footer,5)
        await new Promise(resolve=>setTimeout(resolve,20))
        assert.equal(tree.nodes.some(node=>node.name==='new.txt'),false)
        assert.equal(tree.repositories[0].count,0)
        assert.deepEqual(listCalls,[])
        assert.equal(tree.loading,false)
        assert.equal(tree.manualRefreshing,false)
        assert.equal(tree.commitMessage(tree.repositories[0]),'left draft')
        tree.mode='files'
        const refresh=tree.refreshCurrentView()
        assert.equal(tree.manualRefreshing,true)
        await refresh
        assert.equal(tree.manualRefreshing,false)
        assert.ok(tree.nodes.some(node=>node.name==='new.txt'))
    }finally{tree.ngOnDestroy()}
})

test('plugin follows the resolved Tabby locale and unsubscribes on destroy',()=>{
    const plugin=load()
    let changed,unsubscribed=false,installed=0
    const locale={getLocale:()=> 'en-US',localeChanged$:{subscribe(callback){changed=callback;return {unsubscribe(){unsubscribed=true}}}}}
    const module=new plugin.default({error(){}},{install(){installed++}},locale)
    const pipe=new plugin.default.ngModule.declarations[4]()
    assert.equal(installed,1)
    assert.equal(pipe.transform('当前目录'),'Current directory')
    assert.equal(plugin.TreeComponent.prototype.activityState({status:'success'}),'Success')
    changed('zh-CN');assert.equal(pipe.transform('当前目录'),'当前目录')
    changed('zh-TW');assert.equal(pipe.transform('保存'),'保存')
    changed('de-DE');assert.equal(pipe.transform('保存'),'Save')
    changed(undefined);assert.equal(pipe.transform('取消'),'Cancel')
    module.ngOnDestroy();assert.equal(unsubscribed,true)
})

test('directory row and chevron toggle nested children, render collapse, and ignore double-click second click',async()=>{
    const plugin=load(),Tree=plugin.TreeComponent
    const folder={name:'src',path:'/project/src',directory:true,depth:0},sibling={name:'docs',path:'/project/docs',directory:true,depth:0}
    let renders=0,saved=0,reads=0,opened=0
    const workspace={async list(path){reads++;return path.endsWith('/nested')?[{name:'file.ts',path:path+'/file.ts',directory:false}]:[{name:'nested',path:path+'/nested',directory:true}]}}
    const {FileSelection}=require('../.build/arw-tree/file-selection.js')
    const tree=Object.assign(Object.create(Tree.prototype),{filterText:'',fileSelection:new FileSelection(),browserWorkspace:workspace,nodes:[folder,sibling],version:0,selection:null,
        render(){renders++},rememberBrowsing(){saved++},error:''})
    await tree.clickNode(folder,{detail:1})
    assert.equal(folder.expanded,true);assert.equal(tree.nodes.length,3)
    const nested=tree.nodes[1]
    await tree.toggle(nested);assert.equal(tree.nodes.length,4);assert.equal(tree.nodes[2].depth,2)
    const before=renders
    await tree.toggle(folder)
    assert.equal(folder.expanded,false);assert.equal(tree.nodes.length,2);assert.equal(tree.nodes[1],sibling)
    assert.ok(renders>before,'collapse triggers change detection')
    await tree.clickNode(folder,{detail:1});assert.equal(folder.expanded,true)
    const beforeReads=reads
    await tree.clickNode(folder,{detail:2});assert.equal(folder.expanded,true);assert.equal(reads,beforeReads)
    await tree.clickNode(folder,{detail:1});assert.equal(folder.expanded,false)
    tree.open=async()=>{opened++}
    await tree.clickNode({name:'a.ts',path:'/project/a.ts',directory:false},{detail:1});assert.equal(opened,1)
    await tree.toggle({...folder});assert.equal(tree.nodes.length,2,'stale nodes are ignored')
    assert.ok(saved>=4)
    const template=Tree.component.template
    assert.match(template,/\(click\)="clickNode\(node,\$event\)"/)
    assert.match(template,/\(dblclick\)="node.directory && !node.symlink \? open\(node\) : null"/)
    assert.match(template,/<svg \*ngIf="node.directory"[^>]*fill="none"[^>]*stroke="currentColor"/)
    assert.doesNotMatch(tree.fileIcon(folder),/fas|fa-folder/)
})

test('entering a child reuses completed Git discovery and filters out ancestor repos; manual refresh scans again',async()=>{
    const {BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-git-cache-')),child=join(root,'bin')
    await fs.mkdir(child);const workspace=localWorkspace(root)
    assert.equal((await workspace.run('git init -b main')).exitCode,0)
    const plugin=load(),terminal={},current=new BehaviorSubject({terminal,workspace,hint:''})
    const tree=new plugin.TreeComponent({current},{openNewTab(){}},{info(){}},{},{},{},{})
    try{
        await tree.refresh();await tree.gitScan
        assert.equal(tree.repositories.length,1);assert.equal(tree.repositories[0].root,root)
        let scans=0
        const scan=tree.gitStatus.bind(tree);tree.gitStatus=()=>{scans++;return scan()}
        await tree.open(tree.nodes.find(node=>node.name==='bin'))
        assert.equal(tree.breadcrumb,child);assert.equal(scans,0,'A/B is covered by the completed A scan')
        assert.equal(tree.repositories.length,0,'A repository is excluded from the B view')
        assert.equal(tree.gitScanCompleted,true)
        await tree.up();assert.equal(tree.breadcrumb,root);assert.equal(scans,0)
        assert.equal(tree.repositories.length,1,'returning to A restores the existing result')
        await tree.open(tree.nodes.find(node=>node.name==='bin'))
        assert.equal(scans,0)
        await tree.gitStatus();assert.equal(scans,1,'manual refresh always performs discovery')
        const nested=join(child,'new-project');await fs.mkdir(nested)
        assert.equal((await localWorkspace(nested).run('git init -b main')).exitCode,0)
        await tree.gitStatus();assert.equal(scans,2)
        assert.deepEqual(Array.from(tree.repositories,repository=>repository.root),[nested])
        await tree.up();await tree.gitScan
        assert.equal(scans,3,'refreshing a child invalidates stale overlapping ancestor cache')
    }finally{tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('incomplete Git discovery is reused only at its exact root, with directory boundaries and host isolation',()=>{
    const plugin=load(),Tree=plugin.TreeComponent
    const workspace={kind:'local',host:'host',root:'/A/B'}
    const repository={root:'/A/project',groups:[],workspace}
    const tree=Object.assign(Object.create(Tree.prototype),{selection:{},gitScanCache:new Map(),render(){},
        projectContext:value=>value,currentDirectoryWorkspace:()=>workspace,currentGitScope:()=>workspace.root})
    tree.gitScanCache.set('A',{root:'/A',context:'local:host',repositories:[repository],complete:false,notice:'limited'})
    assert.equal(tree.reuseGitScan(),false,'a truncated parent cannot cover unseen descendants')
    workspace.root='/A';assert.equal(tree.reuseGitScan(),true)
    workspace.root='/AB';assert.equal(tree.reuseGitScan(),false,'shared path prefixes do not imply ancestry')
    workspace.root='/A/B';workspace.host='another-host';assert.equal(tree.reuseGitScan(),false)
})

test('local workspaces open AI directly without forwarding or forwarding status',async()=>{
    const {BehaviorSubject}=await import('rxjs'),fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-local-workspace-')),plugin=load(),config={store:{omw:{}},async save(){}}
    const store=plugin.default.ngModule.providers.find(entry=>entry.useFactory).useFactory(config)
    const workspace=localWorkspace(root),project=await store.add(workspace,root),terminal={}
    let launched
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{async launchConfigured(selection){launched=selection}},{},store)
    try{
        tree.selection={terminal,workspace,hint:''}
        await store.open(project,workspace)
        assert.equal(store.connection(project.id),undefined)
        assert.equal(store.forwards.size,0)
        assert.equal(tree.projectForwardingTitle(project),root)
        tree.restoreProjectForwarding()
        assert.equal(store.forwards.size,0)
        await tree.toggleTerminalMode()
        assert.equal(tree.terminalMode,false)
        assert.match(plugin.TreeComponent.component.template,/\*ngIf="isRemote" class="icon-button" \[class.terminal-mode\]/)
        await tree.launchProject(project)
        assert.equal(launched,undefined,'unselected workspace cannot launch AI')
        tree.activeProject=project.id
        await tree.launchProject(project)
        assert.equal(launched.workspace.root,root)
        assert.equal(launched.workspace.kind,'local')
        assert.match(plugin.TreeComponent.component.template,/isRemote && !terminalMode.*class="forwarding-status"/)
    }finally{tree.ngOnDestroy();await store.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})


test('editor conflict choices overwrite explicitly or reload the latest file',async()=>{
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const {localWorkspace}=require('../.build/arw-tree/workspace.js'),plugin=load()
    const root=await fs.mkdtemp(join(tmpdir(),'arw-conflict-choice-'))
    try{
        for(const response of [0,1]){
            const path=join(root,'file.txt');await fs.writeFile(path,'original')
            const prompts=[],writes=[],workspace=localWorkspace(root),write=workspace.write.bind(workspace)
            workspace.write=async(...args)=>{writes.push(args);return write(...args)}
            const editor=new plugin.EditorComponent({get:()=>({showMessageBox:async options=>{prompts.push(options);return {response}}})})
            editor.setTitle=()=>{};editor.workspace=workspace;editor.filePath='file.txt'
            try{
                await editor.ngOnInit();editor.content='local draft'
                await fs.writeFile(path,'latest external content')
                await editor.save()
                assert.equal(prompts.length,1);assert.equal(prompts[0].defaultId,0)
                assert.match(prompts[0].message,/覆盖|Overwrite/)
                const expected=response===1?'local draft':'latest external content'
                assert.equal(await fs.readFile(path,'utf8'),expected)
                assert.equal(editor.content,expected);assert.equal(editor.original,expected)
                assert.equal(editor.hash,(await workspace.read('file.txt')).hash)
                assert.equal(editor.dirty,false);assert.equal(editor.error,'');assert.equal(editor.saving,false)
                assert.equal(writes.length,response===1?2:1)
                if(response===1)assert.equal(writes[1][2],undefined,'only explicit overwrite bypasses the old version')
            }finally{editor.ngOnDestroy()}
        }
    }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('conflict resolution failures retain the draft and ordinary failures never prompt for overwrite',async()=>{
    const {FileConflictError}=require('../.build/shared/file-conflict.js'),plugin=load()
    for(const scenario of ['reload-fails','overwrite-fails','ordinary-failure']){
        let prompts=0,writes=0,reads=0
        const editor=new plugin.EditorComponent({get:()=>({showMessageBox:async()=>{prompts++;return {response:scenario==='overwrite-fails'?1:0}}})})
        editor.setTitle=()=>{};editor.filePath='file.txt'
        editor.workspace={read:async()=>{
            if(reads++)throw new Error('reload failed')
            return {content:'original',hash:'original-version'}
        },write:async()=>{
            writes++
            if(scenario==='ordinary-failure'||writes>1)throw new Error('write failed')
            throw new FileConflictError('changed')
        }}
        try{
            await editor.ngOnInit();editor.content='local draft';await editor.save()
            assert.equal(editor.content,'local draft');assert.equal(editor.original,'original');assert.equal(editor.dirty,true)
            assert.equal(editor.saving,false);assert.match(editor.error,/failed/)
            assert.equal(prompts,scenario==='ordinary-failure'?0:1)
            assert.equal(writes,scenario==='overwrite-fails'?2:1)
        }finally{editor.ngOnDestroy()}
    }
})

test('Markdown opens as editable source and previews the unsaved buffer in the same tab',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load(),opened=[],writes=[]
    const workspace={id:'markdown',kind:'local',root:'/project',host:'localhost',name:'project',label:'project',
        read:async()=>({content:'# Original',hash:'version'}),write:async(...args)=>{writes.push(args);return {content:args[1],hash:'saved'}},
        readBytes:async()=>Buffer.from('image bytes')}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{openNewTab:entry=>opened.push(entry)},{},{},{},{},{})
    tree.selection={terminal:{},workspace}
    let editor
    try{
        for(const path of ['README.md','notes.MD','notes.markdown','notes.mdown','notes.mkd']){
            await tree.open({name:path,path,directory:false,symlink:false,depth:0})
            assert.equal(opened.at(-1).type,plugin.EditorComponent)
        }
        await tree.open({name:'image.png',path:'image.png',directory:false,symlink:false,depth:0})
        assert.equal(opened.at(-1).type,plugin.PreviewComponent,'image routing is preserved')
        editor=new plugin.EditorComponent({get:()=>({})});editor.setTitle=()=>{}
        Object.assign(editor,opened[0].inputs);await editor.ngOnInit()
        assert.equal(editor.readonly,false);assert.equal(editor.markdownPreview,false)
        editor.content='# Unsaved heading\n\n![diagram](diagram.png)\n\n<script>bad()</script>'
        await editor.toggleMarkdown()
        assert.equal(editor.markdownPreview,true);assert.match(editor.markdown,/<h1[^>]*>Unsaved heading<\/h1>/)
        assert.match(editor.markdown,/data:image\/png;base64,/);assert.doesNotMatch(editor.markdown,/<script>/)
        assert.equal(writes.length,0);assert.equal(editor.dirty,true)
        await editor.toggleMarkdown();assert.equal(editor.markdownPreview,false);assert.match(editor.content,/# Unsaved heading/)
        await editor.toggleMarkdown();editor.search.open();assert.equal(editor.markdownPreview,false,'find returns to editable source')
        editor.search.close();editor.content=editor.original;await editor.toggleMarkdown()
        workspace.read=async()=>({content:'# Refreshed remotely',hash:'new-version'})
        await editor.reloadOpenFile()
        assert.equal(editor.markdownPreview,true);assert.match(editor.markdown,/Refreshed remotely/)
        assert.match(plugin.EditorComponent.component.template,/toggleMarkdown\(\)/)
        assert.match(plugin.EditorComponent.component.template,/!isDiff && !markdownPreview/)
    }finally{editor?.ngOnDestroy();tree.ngOnDestroy()}
})

test('editor retains unconfirmed content, verifies without discarding newer edits, and confirms reload',async()=>{
    const plugin=load()
    let response=0,writes=0,reloads=0,retries=0,issue
    const editor=new plugin.EditorComponent({get:()=>({showMessageBox:async()=>({response})})})
    editor.setTitle=()=>{}
    editor.workspace={label:'fixture',read:async()=>({content:'old',hash:'old-hash'}),
        saveIssue:()=>issue,
        write:async()=>{writes++;issue={message:'unconfirmed',busy:false};throw Error('disconnected')},
        verifySave:async()=>{issue=undefined;return {content:'attempted',hash:'attempted-hash'}},
        reloadSave:async()=>{reloads++;issue=undefined;return {content:'remote',hash:'remote-hash'}},
        retrySave:async(_path,content)=>{retries++;issue=undefined;return {content,hash:'retry-hash'}},
    }
    editor.filePath='file';await editor.ngOnInit()
    editor.content='attempted';await editor.save()
    assert.equal(editor.content,'attempted');assert.equal(editor.original,'old');assert.equal(editor.dirty,true)
    assert.equal(editor.saving,false);assert.match(editor.error,/disconnected/)
    await editor.save();assert.equal(writes,1)
    editor.content='newer local edits';await editor.verifySave()
    assert.equal(editor.original,'attempted');assert.equal(editor.hash,'attempted-hash');assert.equal(editor.content,'newer local edits');assert.equal(editor.dirty,true)
    issue={message:'unconfirmed',busy:false}
    await editor.reloadSave();assert.equal(reloads,0);assert.equal(editor.content,'newer local edits');assert.ok(editor.saveIssue)
    response=1;await editor.reloadSave()
    assert.equal(reloads,1);assert.equal(editor.content,'remote');assert.equal(editor.original,'remote');assert.equal(editor.hash,'remote-hash')
    assert.equal(editor.dirty,false);assert.equal(editor.saveIssue,undefined)
    issue={message:'unconfirmed',busy:false};editor.content='keep local edits';response=0
    await editor.retrySave();assert.equal(retries,0);assert.equal(editor.content,'keep local edits');assert.ok(editor.saveIssue)
    response=1;await editor.retrySave();assert.equal(retries,1);assert.equal(editor.content,'keep local edits');assert.equal(editor.original,'keep local edits');assert.equal(editor.hash,'retry-hash');assert.equal(editor.saveIssue,undefined)
    assert.match(plugin.EditorComponent.component.template,/核对远端文件/)
})

test('open unmodified files refresh with their workspace, while local edits are preserved',async()=>{
    const plugin=load()
    let content='before',reads=0
    const workspace={id:'local',kind:'local',root:'/workspace',host:'localhost',label:'/workspace',name:'workspace',
        async read(){reads++;return {content,hash:content}},async write(_path,next){content=next;return {content:next,hash:next}}}
    const editor=new plugin.EditorComponent({get:()=>({showMessageBox:async()=>({response:0})})});editor.setTitle=()=>{}
    editor.workspace=workspace;editor.filePath='file';await editor.ngOnInit()
    content='remote change';await editor.reloadOpenFile()
    assert.equal(editor.content,'remote change');assert.equal(editor.original,'remote change');assert.equal(editor.dirty,false)
    editor.content='local edit';content='another remote change';await editor.reloadOpenFile()
    assert.equal(editor.content,'local edit');assert.equal(editor.original,'remote change');assert.equal(editor.dirty,true)
    assert.ok(reads>=2)
})

test('editor tab dots persist until edits and save issues are resolved',async()=>{
    const plugin=load()
    let issue
    const editor=new plugin.EditorComponent({get:()=>({})})
    editor.setTitle=value=>{editor.title=value}
    editor.workspace={saveIssue:()=>issue};editor.filePath='file'
    editor.content='edited';editor.original='original';editor.ngDoCheck()
    assert.equal(editor.title,'● Edit · file')
    editor.original=editor.content;issue={message:'unconfirmed',busy:false};editor.ngDoCheck()
    assert.equal(editor.title,'● Edit · file')
    editor.ngDoCheck();assert.equal(editor.title,'● Edit · file')
    issue=undefined;editor.ngDoCheck();assert.equal(editor.title,'Edit · file')
})

test('local terminals hide activity and remote/local headings follow the selection',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{})
    try {
        tree.selection={terminal:{},workspace:{kind:'local'}}
        tree.setMode('activity')
        assert.equal(tree.mode,'files')
        assert.equal(tree.activities.length,0)
        assert.equal(tree.runningActivities,0)
        const template=plugin.TreeComponent.component.template
        assert.match(template, /\*ngIf="isRemote" \[class.selected\]="mode==='activity'"/)
        assert.match(template, /isRemote \? 'AI Remote Workspace' : 'AI Local Workspace'/)
        tree.selection={terminal:{},remote:{}}
        tree.setMode('activity')
        assert.equal(tree.mode,'activity')
    }finally{tree.ngOnDestroy()}
})

test('background Git refresh queries each repository once, throttles bursts, and rejects incomplete status',async()=>{
    const Tree=load().TreeComponent
    let calls=0,applied=0,truncated=false
    const repository={workspace:{async run(_command,signal,options){calls++;assert.ok(signal);assert.equal(options.maxBytes,256*1024);return {exitCode:0,stdout:'?? file.txt\0',stderr:'',truncated}}}}
    const tab={}
    const tree=Object.assign(Object.create(Tree.prototype),{version:1,activeTab:tab,gitScope:'scope',gitLoading:false,
        repositories:[repository],gitWatchLastRefresh:0,render(){},applyGitChanges(_repository,changes){applied++;assert.equal(changes[0].path,'file.txt')}})
    await tree.refreshWatchedGit()
    assert.equal(calls,1);assert.equal(applied,1)
    await tree.refreshWatchedGit()
    assert.equal(calls,1);assert.equal(tree.workspaceChangePending,true)
    tree.gitWatchLastRefresh=0;truncated=true
    await tree.refreshWatchedGit()
    assert.equal(applied,1)
    assert.equal(repository.message,undefined,'incomplete background status stays silent')
})


test('tab workspace belongs to its source terminal across AI close, preview focus and background events',async()=>{
    const {Subject}=await import('rxjs'),plugin=load()
    const terminal=(root)=>({profile:{type:'local',options:{}},hasFocus:false,focused$:new Subject(),sessionChanged$:new Subject(),destroyed$:new Subject(),
        session:{getWorkingDirectory:async()=>root,oscProcessor:{cwdReported$:new Subject()},output$:new Subject(),destroyed$:new Subject()}})
    const source=terminal('/source'),ai=terminal('/agent'),local=terminal('/local'),preview={}
    ai.profile.options.env={ARW_WORKSPACE_ROOT:'/source'}
    let panes=[source,ai,preview],focused=source
    const split={getAllTabs:()=>panes,getFocusedTab:()=>focused}
    const app={tabs:[split,local],activeTab:split,activeTabChange$:new Subject(),getParentTab:t=>panes.includes(t)?split:undefined}
    const registry=new plugin.WorkspaceRegistry(app,{run:fn=>fn()})
    try{
        for(const pane of [source,ai,local])registry.register(pane)
        await new Promise(resolve=>setTimeout(resolve,0))
        const original=registry.current.value
        assert.equal(original.terminal,source)
        const events=[];const sub=registry.current.subscribe(value=>events.push(value))
        registry.pin(ai,{terminal:source,workspace:{kind:'remote',root:'/ai-project'},hint:''})
        focused=ai;ai.focused$.next()
        assert.equal(registry.current.value,original,'AI context never replaces the source workspace')
        focused=preview
        registry.unregister(ai);panes=[source,preview]
        assert.equal(registry.current.value,original,'closing AI does not clear or restore the source selection')
        assert.equal(events.length,1,'AI focus and close emit no sidebar changes')
        app.activeTab=local;app.activeTabChange$.next(local)
        const localSelection=registry.current.value
        source.hasFocus=true;source.focused$.next()
        source.session.oscProcessor.cwdReported$.next()
        await new Promise(resolve=>setTimeout(resolve,0))
        assert.equal(registry.current.value,localSelection,'background focus and cwd cannot select another tab')
        app.activeTab=split;app.activeTabChange$.next(split)
        assert.equal(registry.current.value.terminal,source,'preview focus does not prevent selecting the source tab')
        sub.unsubscribe()
    }finally{for(const pane of [source,ai,local])registry.unregister(pane)}
})

test('entering Git fetches once after discovery and abandons requests when leaving the page',async()=>{
    const {BehaviorSubject}=require('rxjs'),plugin=load()
    const workspace={kind:'local',root:'/fixture',label:'fixture',list:async()=>[],run:async()=>({stdout:'',stderr:'',exitCode:128})}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{disable:async()=>{}},{},{},{})
    tree.selection={terminal:{},workspace,hint:''};tree.activeTab={};tree.browserWorkspace=workspace
    const repository={workspace,root:workspace.root,busy:false,loading:false}
    tree.repositories=[repository]
    let finish,scans=0
    tree.ensureGitScan=()=>{scans++;tree.gitScan=new Promise(resolve=>{finish=resolve})}
    const calls=[];tree.localSync=async(action,repo,quiet)=>calls.push([action,repo,quiet])
    try{
        tree.setMode('git')
        assert.equal(calls.length,0,'wait for repository discovery')
        finish();await tree.autoFetch
        assert.equal(calls.length,1);assert.equal(calls[0][0],'fetch');assert.equal(calls[0][1],repository);assert.equal(calls[0][2],true)
        tree.setMode('git');await tree.autoFetch
        assert.equal(scans,1,'selecting an already active Git page does not fetch again')
        tree.setMode('files');tree.setMode('git')
        const pending=tree.autoFetch
        tree.setMode('files');finish();await pending
        assert.equal(calls.length,1,'leaving Git before discovery completes cancels the automatic request')
        tree.setMode('git');finish();await tree.autoFetch
        assert.equal(calls.length,2,'reentering Git fetches again')
        assert.match(plugin.TreeComponent.component.template,/syncGit\('fetch',repository\)/)
    }finally{tree.ngOnDestroy()}
})


test('background Git operations preserve notices while manual failures remain visible',async()=>{
    const {BehaviorSubject}=require('rxjs'),plugin=load()
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{disable:async()=>{}},{},{},{})
    const repository={root:'/fixture',error:'previous error',message:'previous message'}
    tree.repositories=[repository]
    tree.git=()=>({status:async()=>{throw new Error('status failed')}})
    try{
        await tree.gitOperation(repository,async()=>{throw new Error('fetch failed')},'fetched',true)
        assert.equal(repository.error,'previous error')
        assert.equal(repository.message,'previous message')
        assert.equal(tree.gitNoticeByRoot.size,0)
        await tree.gitOperation(repository,async()=>{},'fetched',true)
        assert.equal(repository.message,'previous message','automatic success is silent too')
        await tree.gitOperation(repository,async()=>{throw new Error('manual failed')})
        assert.match(tree.gitNoticeByRoot.get(repository.root).error,/manual failed/)
    }finally{tree.ngOnDestroy()}
})

test('workspace browser and terminal cwd survive JSON recovery in a fresh plugin instance',async()=>{
    const {BehaviorSubject,Subject}=require('rxjs')
    const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
    const root=await fs.mkdtemp(join(tmpdir(),'arw-workspace-recovery-'))
    await fs.writeFile(join(root,'remembered.txt'),'content')
    const create=(plugin,profile)=>{
        const terminal={profile,session:{getWorkingDirectory:async()=>root},getRecoveryToken:async()=>({type:'app:local-tab',profile:terminal.profile})}
        const decorator=new plugin.WorkspaceTerminalDecorator({register(){},selectionChanged:new Subject()})
        decorator.attach(terminal)
        const current=new BehaviorSubject(null)
        const tree=new plugin.TreeComponent({current},{},{},{disable:async()=>{}},{},{},{})
        tree.ensureGitScan=()=>{}
        return {terminal,current,tree}
    }
    let first,second
    try{
        const {localWorkspace}=require('../.build/arw-tree/workspace.js')
        first=create(load(),{type:'local',options:{cwd:'/old'}})
        first.current.next({terminal:first.terminal,workspace:localWorkspace(root),hint:''})
        await first.tree.refresh();first.tree.setMode('git')
        const token=JSON.parse(JSON.stringify(await first.terminal.getRecoveryToken()))
        assert.equal(token.profile.options.cwd,root)
        second=create(load(),token.profile)
        second.current.next({terminal:second.terminal,workspace:localWorkspace(tmpdir()),hint:''})
        for(let i=0;i<100&&second.tree.loading;i++)await new Promise(resolve=>setTimeout(resolve,5))
        assert.equal(second.tree.breadcrumb,root)
        assert.equal(second.tree.mode,'git')
        assert.equal(second.tree.nodes[0].name,'remembered.txt')
    }finally{first?.tree.ngOnDestroy();second?.tree.ngOnDestroy();await fs.rm(root,{recursive:true,force:true})}
})

test('workspace recovery prepares SSH startup before the host creates the shell',async()=>{
    const plugin=load()
    const Provider=plugin.default.ngModule.providers.filter(entry=>entry.provide===TabRecoveryProvider).at(-1).useClass
    let started
    const provider=new Provider({get(){return {async newTabParametersForProfile(profile){
        started=profile
        assert.equal(profile.options.scripts[0].send," cd -- '/home/user/project'")
        return {type:SSHTabComponent,inputs:{profile:{...profile,options:{scripts:profile.options.scripts}}}}
    }}}})
    const token={type:'arw-workspace:ssh',profile:{type:'ssh',options:{arwWorkspace:{root:'/home/user/project',mode:'files'},scripts:[{expect:'prompt',send:'echo ready'}]}},savedState:'screen'}
    assert.equal(await provider.applicableTo(token),true)
    assert.equal(await provider.applicableTo({type:'app:ssh-tab'}),false)
    const recovered=await provider.recover(JSON.parse(JSON.stringify(token)))
    assert.equal(recovered.inputs.profile.options.arwWorkspace.root,'/home/user/project')
    assert.equal(recovered.inputs.profile.options.scripts,started.options.scripts)
    assert.equal(recovered.inputs.savedState,'screen')
    assert.equal(token.profile.options.scripts.length,1,'saved connection profile remains unchanged')
})

test('decorated workspace changes save the host recovery snapshot immediately',async()=>{
    const {BehaviorSubject,Subject}=require('rxjs'),plugin=load(),snapshots=[]
    const profile={type:'local',options:{}}
    const terminal={profile,session:{getWorkingDirectory:async()=>'/home/user'},getRecoveryToken:async()=>({type:'app:local-tab',profile})}
    const app={tabs:[terminal]}
    const recovery={async saveTabs(tabs){snapshots.push(await tabs[0].getRecoveryToken())}}
    const decorator=new plugin.WorkspaceTerminalDecorator({register(){},selectionChanged:new Subject()},undefined,undefined,app,undefined,recovery)
    decorator.attach(terminal)
    const current=new BehaviorSubject(null)
    const tree=new plugin.TreeComponent({current},{},{},{disable:async()=>{}},{},{},{})
    tree.ensureGitScan=()=>{}
    try{
        const workspace={kind:'local',root:'/home/user/project',list:async()=>[],run:async()=>({exitCode:128,stdout:'',stderr:''})}
        current.next({terminal,workspace,hint:''})
        await tree.refresh()
        await new Promise(resolve=>setImmediate(resolve))
        assert.ok(snapshots.length)
        assert.equal(snapshots.at(-1).profile.options.arwWorkspace.root,'/home/user/project')
        assert.equal(snapshots.at(-1).profile.options.arwWorkspace.cwd,'/home/user')
    }finally{tree.ngOnDestroy();decorator.ngOnDestroy()}
})

test('workspace switching blocks repeated selection and releases buttons after failures',async()=>{
    const plugin=load()
    let finish,loads=0
    const tree=Object.assign(Object.create(plugin.TreeComponent.prototype),{
        switchingWorkspace:false,projectSelectionRequest:0,activeTab:{},selection:{},app:{tabs:[]},
        savedWorkspace:()=>({kind:'local',root:'/project'}),render(){},
        showWorkspace(workspace){this.browserWorkspace=workspace;loads++;return new Promise(resolve=>{finish=resolve})},
    })
    const pending=tree.selectProject({id:'one'})
    assert.equal(tree.switchingWorkspace,true)
    await tree.selectProject({id:'two'})
    assert.equal(loads,1)
    finish();await pending
    assert.equal(tree.switchingWorkspace,false)
    tree.showWorkspace=async()=>{throw Error('directory failure')}
    await assert.rejects(tree.selectProject({id:'two'}),/directory failure/)
    assert.equal(tree.switchingWorkspace,false)
})

test('AI launch stops if workspace selection changes while forwarding starts',async()=>{
    const plugin=load()
    let finish,launched=0
    const tree=Object.assign(Object.create(plugin.TreeComponent.prototype),{
        switchingWorkspace:false,activeProject:'one',projectSelectionRequest:1,activeTab:{},selection:{terminal:{}},
        savedWorkspace:()=>({kind:'remote',root:'/project'}),terminalMode:false,
        projectStore:{open(){return new Promise(resolve=>{finish=resolve})},connection(){return {}}},
        ai:{async launchConfigured(){launched++}},
    })
    const pending=tree.launchProject({id:'one'})
    tree.projectSelectionRequest++;tree.activeProject='two'
    finish();await pending
    assert.equal(launched,0)
})

test('switching workspaces restores expanded directory trees independently',async()=>{
    const {BehaviorSubject}=await import('rxjs')
    const plugin=load(),terminal={}
    const workspace=root=>({id:root,kind:'local',host:'localhost',root,label:root,
        async list(path){if(path==='.')return [{name:'src',path:'src',directory:true,symlink:false}];if(path==='src')return [{name:'nested',path:'src/nested',directory:true,symlink:false}];return [{name:'file',path:'src/nested/file',directory:false,symlink:false}]}})
    const one=workspace('/one'),two=workspace('/two')
    const current=new BehaviorSubject({terminal,workspace:one,hint:''})
    const tree=new plugin.TreeComponent({current},{},{},{disable:async()=>{}},{},{},{})
    try{
        await tree.showWorkspace(one)
        await tree.toggle(tree.nodes[0]);await tree.toggle(tree.nodes[1])
        tree.updateFilter('nested')
        await tree.showWorkspace(two)
        assert.equal(tree.filterText,'')
        tree.updateFilter('src')
        assert.equal(tree.nodes[0].expanded,undefined)
        await tree.toggle(tree.nodes[0])
        await tree.showWorkspace(one)
        assert.equal(tree.filterText,'nested')
        assert.equal(tree.nodes[0].expanded,true)
        assert.equal(tree.nodes[1].expanded,true)
        assert.equal(tree.nodes[2].path,'src/nested/file')
        await tree.showWorkspace(two)
        assert.equal(tree.filterText,'src')
        assert.equal(tree.nodes[0].expanded,true)
        assert.ok(!tree.nodes[1].expanded)
    }finally{tree.ngOnDestroy()}
})

test('cached workspace restoration completes before a slow directory revalidation',async()=>{
    const {BehaviorSubject}=await import('rxjs'),plugin=load()
    const one={kind:'local',host:'localhost',root:'/one',list:async()=>[{name:'file',path:'file',directory:false,symlink:false}]}
    const two={...one,root:'/two'}
    const tree=new plugin.TreeComponent({current:new BehaviorSubject(null)},{},{},{},{},{},{})
    tree.activeTab={};tree.selection={terminal:{},workspace:one};tree.ensureGitScan=()=>{}
    let release,restored=false
    try{
        await tree.showWorkspace(one);await tree.showWorkspace(two)
        one.list=()=>new Promise(resolve=>{release=resolve})
        const pending=tree.showWorkspace(one).then(()=>{restored=true})
        await new Promise(resolve=>setImmediate(resolve))
        assert.equal(restored,true,'restoring live panes must not depend on the network read')
        assert.equal(tree.nodes[0].path,'file');assert.equal(tree.loading,false)
        assert.ok(release,'background revalidation still runs')
        release([]);await pending
    }finally{release?.([]);tree.ngOnDestroy()}
})

test('expanded directory refresh is bounded, preserves display order and stops queued reads on cancellation',async()=>{
    const plugin=load(),directories=Array.from({length:8},(_,index)=>({name:`dir${index}`,path:`dir${index}`,directory:true,symlink:false}))
    const waiting=[]
    let running=0,peak=0,reads=0
    const workspace={root:'/project',async list(path){
        if(path==='.')return directories
        reads++;running++;peak=Math.max(peak,running)
        try{return await new Promise(resolve=>waiting.push(()=>resolve([{name:'file',path:`${path}/file`,directory:false,symlink:false}])))}
        finally{running--}
    }}
    const tree=Object.assign(Object.create(plugin.TreeComponent.prototype),{browserWorkspace:workspace,nodes:directories.map(node=>({...node,depth:0,expanded:true})),
        version:0,treeRequest:0,relativePath:'',error:'',directoryListings:new Map(),render(){},rememberBrowsing(){},ensureGitScan(){}})
    const tick=()=>new Promise(resolve=>setImmediate(resolve))
    const pending=tree.refreshFiles({background:true})
    await tick()
    assert.equal(waiting.length,4)
    while(waiting.length){waiting.splice(0).reverse().forEach(finish=>finish());await tick()}
    await pending
    assert.equal(peak,4);assert.equal(reads,8)
    assert.deepEqual(tree.nodes.map(node=>node.path),directories.flatMap(node=>[node.path,`${node.path}/file`]))
    const original=tree.nodes
    reads=0
    const cancelled=tree.refreshFiles({background:true})
    await tick();assert.equal(waiting.length,4)
    tree.treeAbort.abort()
    waiting.splice(0).forEach(finish=>finish());await cancelled
    assert.equal(reads,4,'queued requests must not start after switching away')
    assert.equal(tree.nodes,original,'late responses cannot replace the visible tree')
    assert.equal(tree.error,'')
})

test('background refresh does not cancel a foreground refresh or leave its loading state stuck',async()=>{
    const plugin=load(),waiting=[],signals=[]
    const workspace={root:'/project',list:(_path,signal)=>{signals.push(signal);return new Promise(resolve=>waiting.push(resolve))}}
    const tree=Object.assign(Object.create(plugin.TreeComponent.prototype),{browserWorkspace:workspace,nodes:[],version:0,treeRequest:0,
        relativePath:'',error:'',loading:false,directoryListings:new Map(),render(){},rememberBrowsing(){},ensureGitScan(){}})
    const foreground=tree.refreshFiles()
    assert.equal(tree.loading,true)
    const background=tree.refreshFiles({background:true})
    const cancelled=signals[0].aborted,reads=waiting.length
    const file={name:'file',path:'file',directory:false,symlink:false}
    waiting.forEach(resolve=>resolve([file]))
    await Promise.all([foreground,background])
    assert.equal(cancelled,false,'watch notifications must not cancel the foreground read')
    assert.equal(reads,1)
    assert.equal(tree.loading,false)
    assert.equal(tree.nodes[0].path,'file')
    const next=tree.refreshFiles({background:true})
    assert.equal(waiting.length,2,'background refresh resumes after the foreground read')
    waiting[1]([]);await next
    assert.equal(tree.nodes.length,0)
})

test('restored workspace bindings preserve remote identity in editor and preview recovery tokens',async()=>{
    const plugin=load(),source=new SSHTabComponent()
    source.sshSession={open:true,profile:{id:'ssh-test',options:{host:'example',port:2222,user:'dev'}},willDestroy$:{subscribe:()=>({unsubscribe(){}})}}
    const terminal={profile:{options:{env:{}}}}
    const entry={selection:{terminal},restored:{host:'example',port:2222,user:'dev',remoteRoot:'/project',workspaceId:'bound-workspace',terminalOnly:false}}
    const registry=Object.assign(Object.create(plugin.WorkspaceRegistry.prototype),{
        entries:new Map([[source,{selection:{}}],[terminal,entry]]),selectionChanged:{next(){}},current:{value:undefined}})
    registry.restoreBindings()
    assert.equal(entry.selection.workspace.id,'bound-workspace')
    for(const Component of [plugin.EditorComponent,plugin.PreviewComponent]){
        const pane=new Component({get:()=>({})})
        pane.workspace=entry.selection.workspace;pane.filePath='file.txt'
        const token=await pane.getRecoveryToken()
        assert.ok(token,'file panes opened from the restored binding must be recoverable')
        assert.deepEqual(JSON.parse(JSON.stringify(token.workspace)),{kind:'remote',root:'/project',host:'example',port:2222,user:'dev',profileId:'ssh-test'})
    }
})
