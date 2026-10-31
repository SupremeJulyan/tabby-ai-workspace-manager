import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { openFilePane } from '../src/arw-tree/open-file-pane'
import { tileWorkspacePanes } from '../src/arw-ai-cli/tiling'
import { addAiCloseButton } from '../src/arw-ai-cli/close-button'
import { selectedStackedPane, selectStackedPane, stackedHiddenPanes } from '../src/shared/pane-layout'
import { workspaceHiddenPanes } from '../src/shared/workspace-pane-visibility'

class Container {
    orientation='h';children:any[]=[];ratios:number[]=[]
    constructor(children:any[]=[],ratios?:number[]){this.children=children;this.ratios=ratios??children.map(()=>1/children.length)}
    getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
}

test('workspace switches retain independent stacked file and AI selections',()=>{
    const split={}
    for(const kind of ['file','ai'] as const){
        const first=[{},{},{}],second=[{},{}]
        selectStackedPane(split,kind,first[1],first)
        selectStackedPane(split,kind,second[0],second)
        assert.equal(selectedStackedPane(split,kind,first),first[1])
        assert.equal(selectedStackedPane(split,kind,second),second[0])
    }
})

test('opening a pane does not overwrite the inactive workspace selection',()=>{
    for(const kind of ['file','ai'] as const){
        const split={},a={},b={},other={}
        selectStackedPane(split,kind,b,[a,b])
        workspaceHiddenPanes.add(a);workspaceHiddenPanes.add(b)
        selectStackedPane(split,kind,other,[a,b,other])
        workspaceHiddenPanes.delete(a);workspaceHiddenPanes.delete(b)
        assert.equal(selectedStackedPane(split,kind,[a,b]),b)
        selectStackedPane(split,kind,a,[a,b])
        workspaceHiddenPanes.add(a);workspaceHiddenPanes.add(b)
        selectStackedPane(split,kind,other,[other])
        workspaceHiddenPanes.delete(a);workspaceHiddenPanes.delete(b)
        assert.equal(selectedStackedPane(split,kind,[a,b]),a)
    }
})

function area(node:any,pane:any,weight=1):number {
    return node instanceof Container?node.children.reduce((sum,child,index)=>sum+area(child,pane,weight*node.ratios[index]),0):node===pane?weight:0
}

test('stacked files and AI panes keep their tiled placement and show exactly one member',()=>{
    const files=Array.from({length:3},()=>({arwFilePane:true,arwPaneLayout:'stacked'}))
    const ai=Array.from({length:3},(_,index)=>({profile:{options:{env:{ARW_WORKSPACE_ROOT:`/project${index}`,ARW_PANE_LAYOUT:'stacked'}}}}))
    const terminal={name:'main'},split:any={root:new Container([terminal,...files,...ai]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>null,maximize(){},layout(){}}
    const app:any={activeTab:split,emitTabsChanged(){}}
    selectStackedPane(split,'file',files[1],files)
    selectStackedPane(split,'ai',ai[2],ai)
    assert.equal(tileWorkspacePanes(app),true)
    assert.equal(split.root.orientation,'h')
    assert.deepEqual(split.root.ratios,[.5,.5])
    const workspace=split.root.children[0],fileGrid=workspace.children[0]
    assert.equal(workspace.orientation,'v');assert.deepEqual(workspace.ratios,[.6,.4]);assert.equal(workspace.children[1],terminal)
    assert.deepEqual(fileGrid.getAllTabs(),files);assert.deepEqual(fileGrid.ratios,[0,1,0])
    const aiGrid=split.root.children[1]
    assert.deepEqual(aiGrid.getAllTabs(),ai);assert.deepEqual(aiGrid.ratios,[0,0,1])
    assert.deepEqual(files.map(pane=>stackedHiddenPanes.has(pane)),[true,false,true])
    assert.deepEqual(ai.map(pane=>stackedHiddenPanes.has(pane)),[true,true,false])
})

test('stacked and tiled groups are independently selectable',()=>{
    const files=Array.from({length:2},()=>({arwFilePane:true,arwPaneLayout:'stacked'}))
    const ai=Array.from({length:2},(_,index)=>({profile:{options:{env:{ARW_WORKSPACE_ROOT:`/project${index}`,ARW_PANE_LAYOUT:'tiled'}}}}))
    const split:any={root:new Container([{name:'main'},...files,...ai]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>null,maximize(){},layout(){}}
    const app:any={activeTab:split,emitTabsChanged(){}}
    assert.equal(tileWorkspacePanes(app),true)
    const workspace=split.root.children[0]
    assert.deepEqual(workspace.children[0].ratios,[1,0],'the file group starts stacked')
    assert.ok(ai.every(pane=>area(split.root,pane)>0),'the AI group remains tiled')
    files.forEach(pane=>pane.arwPaneLayout='tiled');ai.forEach(pane=>pane.profile.options.env.ARW_PANE_LAYOUT='stacked')
    assert.equal(tileWorkspacePanes(app),true)
    assert.ok(files.every(pane=>area(split.root,pane)>0),'the file group returns to tiled')
    assert.deepEqual(split.root.children[1].ratios,[1,0],'the AI group becomes stacked')
    assert.ok(files.every(pane=>!stackedHiddenPanes.has(pane)))
})

test('stacked arrows cycle live panes in both directions and wrap without recreating them',async()=>{
    const {Subject}=await import('rxjs')
    const window=new Window(),changed=new Subject<void>(),source={},destroyed:any[]=[]
    const panes=Array.from({length:3},(_,index)=>{
        const host=window.document.createElement('div');window.document.body.append(host)
        return {element:{nativeElement:host},profile:{options:{env:{ARW_WORKSPACE_ROOT:`/workspace${index}`,ARW_PANE_LAYOUT:'stacked'}}},canClose:async()=>true,destroy(){destroyed.push(index)}}
    })
    let focused:any=panes[0]
    const split:any={root:new Container([source,...panes]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(value:any){focused=value},maximize(){},layout(){}}
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,tabsChanged$:changed,emitTabsChanged(){changed.next()}}
    const cleanups=panes.map(pane=>addAiCloseButton(pane as any,app,error=>{throw error})!)
    const host=(index:number)=>panes[index].element.nativeElement as HTMLElement
    const button=(index:number,selector:string)=>host(index).querySelector<HTMLButtonElement>(selector)!
    try{
        assert.equal(tileWorkspacePanes(app,split,true),true)
        const header=host(0).querySelector<HTMLElement>('.arw-ai-header')!
        assert.equal(header.style.gridTemplateColumns,'22px 22px minmax(0, 1fr) 22px')
        for(const item of Array.from(header.children) as HTMLElement[])assert.equal(item.style.gridRow,'1')
        assert.equal(button(0,'.arw-ai-toggle-button').style.gridColumn,'1')
        assert.equal(button(0,'.arw-ai-expand-button').style.gridColumn,'2')
        assert.equal(header.querySelector('span')!.style.gridColumn,'3')
        assert.equal(button(0,'.arw-ai-close-button').style.gridColumn,'4')
        assert.ok(button(0,'.arw-stack-previous'),'the collapse slot becomes the previous arrow')
        assert.ok(button(0,'.arw-stack-next'),'the expand slot becomes the next arrow')
        assert.match(button(0,'.arw-stack-previous').title,/1\/3/)
        assert.equal(stackedHiddenPanes.has(panes[0]),false)
        assert.equal(stackedHiddenPanes.has(panes[1]),true)
        button(0,'.arw-stack-next').click()
        assert.equal(focused,panes[1])
        assert.equal(area(split.root,panes[1]),.5)
        assert.equal(stackedHiddenPanes.has(panes[1]),false)
        assert.equal(area(split.root,panes[0]),0)
        button(1,'.arw-stack-next').click()
        assert.equal(focused,panes[2])
        assert.equal(area(split.root,panes[2]),.5)
        button(2,'.arw-stack-next').click()
        assert.equal(focused,panes[0],'next wraps to the first pane')
        assert.equal(area(split.root,panes[0]),.5)
        button(0,'.arw-stack-previous').click()
        assert.equal(focused,panes[2],'previous wraps to the last pane')
        assert.deepEqual(destroyed,[],'switching keeps every pane instance alive')
    }finally{cleanups.forEach(cleanup=>cleanup());await window.happyDOM.close()}
})

test('a single stacked pane disables both navigation arrows',async()=>{
    const window=new Window(),host=window.document.createElement('div');window.document.body.append(host)
    const pane:any={element:{nativeElement:host},profile:{options:{env:{ARW_WORKSPACE_ROOT:'/workspace',ARW_PANE_LAYOUT:'stacked'}}},canClose:async()=>true,destroy(){}}
    const split:any={getAllTabs:()=>[pane]}
    const app:any={tabs:[],getParentTab:()=>split}
    const cleanup=addAiCloseButton(pane,app,error=>{throw error})!
    try{
        assert.equal(host.querySelector<HTMLButtonElement>('.arw-stack-previous')!.disabled,true)
        assert.equal(host.querySelector<HTMLButtonElement>('.arw-stack-next')!.disabled,true)
    }finally{cleanup();await window.happyDOM.close()}
})

test('opening stacked files selects the newest file while retaining all host instances',async()=>{
    const terminal={name:'main'},created:any[]=[]
    let focused:any=terminal
    const split:any={root:new Container([terminal]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(value:any){focused=value},maximize(){},layout(){},async add(pane:any){this.root.children.push(pane)}}
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,removeTab(){},selectTab(){},emitTabsChanged(){}}
    const tabs={create(params:any){const file:any={arwFilePane:true,arwPaneLayout:params.inputs?.arwPaneLayout};created.push(file);return file}}
    for(let index=0;index<3;index++)await openFilePane(app,{type:class {} as any},terminal,'stacked',tabs)
    assert.deepEqual(created.map(file=>file.arwPaneLayout),['stacked','stacked','stacked'])
    assert.equal(focused,created[2])
    assert.equal(split.root.orientation,'v')
    const grid=split.root.children[0]
    assert.deepEqual(grid.getAllTabs(),created)
    assert.deepEqual(grid.ratios,[0,0,1])
    assert.equal(split.getAllTabs().filter((pane:any)=>pane===created[0]).length,1)
    assert.equal(split.getAllTabs().filter((pane:any)=>pane===created[2]).length,1)
})

test('closing the selected stacked member falls forward, then backward at the end',()=>{
    const split={},files=[{id:0},{id:1},{id:2}]
    selectStackedPane(split,'file',files[1],files)
    assert.equal(selectedStackedPane(split,'file',[files[0],files[2]]),files[2])
    selectStackedPane(split,'file',files[2],files)
    assert.equal(selectedStackedPane(split,'file',[files[0],files[1]]),files[1])
    selectStackedPane(split,'file',files[0],files)
    assert.equal(selectedStackedPane(split,'file',[files[1],files[2]]),files[1])
})

test('reopening an existing file focuses and highlights it without creating another pane',async()=>{
    const window=new Window(),terminal={},created:any[]=[]
    class FilePane { arwFilePane=true; arwPaneLayout='stacked'; workspace:any; filePath=''; element:any; constructor(inputs:any){Object.assign(this,inputs);this.element={nativeElement:window.document.createElement('div')}} }
    const workspace:any={kind:'local',root:'/project',host:'localhost'}
    let focused:any=terminal
    const split:any={root:new Container([terminal]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(value:any){focused=value},maximize(){},layout(){},async add(pane:any){this.root.children.push(pane)}}
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,removeTab(){},selectTab(){},emitTabsChanged(){}}
    const tabs={create(params:any){const file=new FilePane(params.inputs);created.push(file);return file}}
    try{
        const open=(path:string)=>openFilePane(app,{type:FilePane as any,inputs:{workspace,filePath:path}},terminal,'stacked',tabs)
        const first:any=await open('one.txt')
        await open('two.txt')
        const result=await open('./one.txt')
        assert.equal(result,first)
        assert.equal(created.length,2)
        assert.equal(focused,first)
        assert.equal(stackedHiddenPanes.has(first),false)
        assert.equal(stackedHiddenPanes.has(created[1]),true)
        assert.match(first.element.nativeElement.style.outline,/rgb\(239, 68, 68\)|#ef4444/)
        await new Promise(resolve=>setTimeout(resolve,1600))
        assert.equal(first.element.nativeElement.style.outline,'')
    }finally{await window.happyDOM.close()}
})
