import test from 'node:test'
import assert from 'node:assert/strict'
import { paneMatchesWorkspace } from '../src/shared/pane-kind'
import { activateWorkspacePanes } from '../src/shared/activate-workspace-panes'

test('nested saved workspaces and sibling paths stay distinct',()=>{
    const workspace={kind:'local' as const,root:'/projects/app'}
    for(const root of ['/projects','/projects/app/sub','/projects/application']){
        assert.equal(paneMatchesWorkspace({workspace:{...workspace,root}},workspace),false)
    }
    assert.equal(paneMatchesWorkspace({workspace:{...workspace,root:'/projects/app/'}},workspace),true)
})

test('remote identity must match host, port and user, including restored file metadata',()=>{
    const identity={kind:'remote' as const,root:'/app',host:'server',port:2222,user:'alice'}
    assert.equal(paneMatchesWorkspace({arwWorkspaceIdentity:identity},identity),true)
    for(const change of [{host:'other'},{port:22},{user:'bob'}]){
        assert.equal(paneMatchesWorkspace({arwWorkspaceIdentity:{...identity,...change}},identity),false)
    }
    assert.equal(paneMatchesWorkspace({profile:{options:{env:{ARW_WORKSPACE_ROOT:'/app',ARW_WORKSPACE_KIND:'remote'}}}},identity),false)
})

test('activation prefers the current matching tab and selects only once',()=>{
    const workspace={kind:'local' as const,root:'/app'}
    const first={arwFilePane:true,workspace},second={arwFilePane:true,workspace}
    const selections:unknown[]=[]
    const app:any={tabs:[first,second],activeTab:second,selectTab(tab:unknown){selections.push(tab)}}
    assert.equal(activateWorkspacePanes(app,workspace),true)
    assert.deepEqual(selections,[second])
    selections.length=0
    assert.equal(activateWorkspacePanes(app,{...workspace,root:'/elsewhere'}),false)
    assert.deepEqual(selections,[])
})

test('switching to an empty workspace hides old panes and switching back keeps the same sessions',async()=>{
    const {workspaceHiddenPanes}=await import('../src/shared/workspace-pane-visibility')
    class Container {
        orientation='h';children:any[]=[];ratios:number[]=[]
        getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
    }
    const identity={kind:'local' as const,root:'/one'}
    const file={arwFilePane:true,workspace:identity,arwPaneLayout:'stacked'}
    const ai={profile:{options:{env:{ARW_WORKSPACE_ROOT:'/one',ARW_WORKSPACE_KIND:'local',ARW_PANE_LAYOUT:'stacked'}}}}
    const terminal={}
    let focused:any=file
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab(){return focused},focus(tab:any){focused=tab},maximize(){},layout(){}}
    split.root.children=[terminal,file,ai];split.root.ratios=[.4,.3,.3]
    const app:any={tabs:[split],activeTab:split,selectTab(){},emitTabsChanged(){}}
    const area=(node:any,target:any,weight=1):number=>node instanceof Container?node.children.reduce((sum,child,i)=>sum+area(child,target,weight*node.ratios[i]),0):node===target?weight:0
    activateWorkspacePanes(app,{...identity,root:'/empty'})
    assert.equal(area(split.root,file),0)
    assert.equal(area(split.root,ai),0)
    assert.equal(area(split.root,terminal),1)
    assert.equal(focused,terminal)
    assert.equal(workspaceHiddenPanes.has(file),true)
    assert.equal(split.getAllTabs().length,3)
    activateWorkspacePanes(app,identity)
    assert.ok(area(split.root,file)>0)
    assert.ok(area(split.root,ai)>0)
    assert.equal(workspaceHiddenPanes.has(file),false)
    assert.deepEqual(new Set(split.getAllTabs()),new Set([terminal,file,ai]))
})
