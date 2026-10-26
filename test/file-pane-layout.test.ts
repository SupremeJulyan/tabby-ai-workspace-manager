import test from 'node:test'
import assert from 'node:assert/strict'
import { openFilePane } from '../src/arw-tree/open-file-pane'
import { tileWorkspacePanes } from '../src/arw-ai-cli/tiling'

class Container {
    orientation='h';children:any[]=[];ratios:number[]=[]
    getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
}

test('file grid occupies the upper sixty percent and preserves terminal instances below',()=>{
    const files=[{arwFilePane:true},{arwFilePane:true}],terminal={name:'main'}
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>null,maximize(){},layout(){}}
    split.root.children=[terminal,...files]
    const app:any={activeTab:split,emitTabsChanged(){}}
    assert.equal(tileWorkspacePanes(app),true)
    assert.equal(split.root.orientation,'v')
    assert.deepEqual(split.root.ratios,[.6,.4])
    assert.deepEqual(split.root.children[0].getAllTabs(),files)
    assert.equal(split.root.children[1],terminal)
})

test('tiled file opening reuses the existing top-level split',async()=>{
    const terminal={},file={arwFilePane:true}
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>file,focus(){},maximize(){},layout(){},async add(pane:any){this.root.children.push(pane)}}
    split.root.children=[terminal]
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>null,wrapAndAddTab(){throw Error('Must not wrap a split again')},openNewTabRaw(){this.tabs.push(file);return file},removeTab(tab:any){this.tabs=this.tabs.filter((item:any)=>item!==tab)},selectTab(){},emitTabsChanged(){}}
    assert.equal(await openFilePane(app,{type:class {} as any},null,'tiled',{create:()=>file as any}),file)
    assert.deepEqual(app.tabs,[split])
    assert.deepEqual(split.getAllTabs(),[file,terminal])
})

test('tab layout retains the previous adjacent top-level opening behavior',async()=>{
    const terminal={},file={}
    const app:any={tabs:[terminal],activeTab:terminal,openNewTab(){this.tabs.push(file);return file},getParentTab:()=>null,emitTabsChanged(){}}
    assert.equal(await openFilePane(app,{type:class {} as any},null,'tabs'),file)
    assert.deepEqual(app.tabs,[file,terminal])
})

test('four files tile above the full workspace terminal with AI on the right',()=>{
    const files=Array.from({length:4},()=>({arwFilePane:true})),terminal={name:'main'}
    const ai={profile:{options:{env:{ARW_WORKSPACE_ROOT:'/project'}}}}
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>null,maximize(){},layout(){}}
    split.root.children=[terminal,...files,ai]
    const app:any={activeTab:split,emitTabsChanged(){}}
    assert.equal(tileWorkspacePanes(app),true)
    assert.equal(split.root.orientation,'h')
    const workspace=split.root.children[0]
    assert.equal(workspace.orientation,'v')
    assert.deepEqual(workspace.ratios,[.6,.4])
    assert.equal(workspace.children[1],terminal)
    const grid=workspace.children[0]
    assert.equal(grid.orientation,'v')
    assert.deepEqual(grid.children.map((row:any)=>row.children.length),[2,2])
    assert.deepEqual(grid.getAllTabs(),files)
    assert.deepEqual(split.root.children[1].getAllTabs(),[ai])
    assert.equal(new Set(split.getAllTabs()).size,6)
})

test('opening four files never publishes their host views as top-level tabs',async()=>{
    const terminal={name:'main'},attached=new Set(),created:any[]=[]
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>null,focus(){},maximize(){},layout(){},async add(pane:any){attached.add(pane);this.root.children.push(pane)}}
    split.root.children=[terminal]
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,openNewTabRaw(){throw Error('A top-level tab body could steal the file view')},removeTab(){throw Error('File views must not be removed from the top level')},selectTab(){},emitTabsChanged(){}}
    const tabs={create(){const file:any={arwFilePane:true};created.push(file);return file}}
    for(let index=0;index<4;index++)await openFilePane(app,{type:class {} as any},terminal,'tiled',tabs)
    assert.deepEqual(app.tabs,[split])
    assert.deepEqual(split.getAllTabs(),[...created,terminal])
    assert.equal(attached.size,4)
    assert.equal(split.root.children[1],terminal)
})
