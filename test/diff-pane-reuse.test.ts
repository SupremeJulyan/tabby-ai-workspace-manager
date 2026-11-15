import test from 'node:test'
import assert from 'node:assert/strict'
import { openFilePane } from '../src/arw-tree/open-file-pane'
import { parseDiff } from '../src/arw-tree/git/diff-model'
import { collapsedAiPanes } from '../src/arw-ai-cli/collapsed-panes'
import { stackedHiddenPanes } from '../src/shared/pane-layout'
import { selectedScreenLayer } from '../src/shared/small-screen'
import { SmallScreenController } from '../src/arw-tree/small-screen'
import { Window } from 'happy-dom'
import { Subject } from 'rxjs'

class Container {
    orientation='h';children:any[]=[];ratios:number[]=[]
    getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
}
class FilePane {
    arwFilePane=true;arwPaneLayout='stacked';readonly=false
    workspace:any;filePath='';diffPatch?:string;diffStaged=false;diffLabel?:string;diffDescription?:string
    diff?:ReturnType<typeof parseDiff>
    updateDiff(patch:string):void {this.diffPatch=patch;this.diff=parseDiff(patch)}
}
const patch=(text:string)=>`diff --git a/note.txt b/note.txt\n--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+${text}\n`

test('diff reopens like a file, refreshes its snapshot and keeps staged, history and editable views separate',async()=>{
    const window=new Window(),previous=globalThis.document;globalThis.document=window.document as any
    const focusChanged=new Subject<any>(),changes=new Subject<void>(),active=new Subject<void>(),configChanges=new Subject<void>()
    const terminal={profile:{options:{}}},workspace={kind:'local',root:'/project',host:'localhost'}
    let focused:any=terminal,created=0
    const split:any={root:new Container(),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,
        focus(pane:any){focused=pane;focusChanged.next(pane)},focusChanged$:focusChanged,maximize(){},layout(){},async add(pane:any){this.root.children.push(pane)}}
    split.root.children=[terminal]
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,selectTab(){},emitTabsChanged(){changes.next()},tabsChanged$:changes,activeTabChange$:active}
    const config:any={store:{omw:{smallScreen:true}},changed$:configChanges}
    const controller=new SmallScreenController(app,config,document.createElement('div'),()=>{})
    const tabs={create(params:any){created++;return Object.assign(new FilePane(),params.inputs) as any}}
    const open=(extra:any={})=>openFilePane(app,{type:FilePane as any,inputs:{workspace,filePath:'note.txt',...extra}},terminal,'stacked',tabs)
    const tick=()=>new Promise(resolve=>setTimeout(resolve,15))
    try{
        await tick()
        const edit=await open()
        const diff:any=await open({readonly:true,diffPatch:patch('first')})
        assert.notEqual(diff,edit)
        collapsedAiPanes.add(diff)
        const reopened=await open({readonly:true,diffPatch:patch('updated')})
        await tick()
        assert.equal(reopened,diff);assert.equal(created,2)
        assert.equal(diff.diffPatch,patch('updated'));assert.ok(diff.diff.hunks.length)
        assert.equal(collapsedAiPanes.has(diff),false);assert.equal(stackedHiddenPanes.has(diff),false)
        assert.equal(focused,diff);assert.equal(selectedScreenLayer(split),'files')
        const staged=await open({readonly:true,diffPatch:patch('staged'),diffStaged:true})
        assert.notEqual(staged,diff)
        const history=await open({readonly:true,diffPatch:patch('commit'),diffDescription:'commit1',diffLabel:'parent → current'})
        assert.notEqual(history,diff)
        assert.equal(await open({readonly:true,diffPatch:patch('commit'),diffDescription:'commit1',diffLabel:'parent → current'}),history)
        assert.notEqual(await open({readonly:true,diffPatch:patch('commit'),diffDescription:'commit2',diffLabel:'parent → current'}),history)
        assert.equal(await open(),edit);assert.equal(edit.readonly,false)
        assert.equal(created,5)
    }finally{controller.dispose();globalThis.document=previous;await window.happyDOM.close()}
})
