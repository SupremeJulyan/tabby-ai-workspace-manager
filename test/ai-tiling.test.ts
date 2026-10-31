import test from 'node:test'
import assert from 'node:assert/strict'
import { tileAiTerminals } from '../src/arw-ai-cli/tiling'
class Container {
    orientation='h';children:any[]=[];ratios:number[]=[]
    constructor(children:any[]=[]){this.children=children;this.ratios=children.map(()=>1/children.length)}
    getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
}
test('AI tiling preserves sessions, source panes, focus and other top-level tabs',()=>{
    const source={name:'SSH'},editor={name:'editor'},ai=Array.from({length:4},(_,i)=>({name:`ai${i}`,profile:{options:{env:{ARW_WORKSPACE_ROOT:'/project'}}}}))
    const others=new Container([source,editor]),inactive=new Container([{name:'other tab'}]);let layouts=0,updates=0,focused:any=ai[2],maximized:any=ai[0]
    const split={root:new Container([others,...ai]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(tab:any){focused=tab},maximize(tab:any){maximized=tab},layout(){layouts++}}
    const app:any={activeTab:split,tabs:[split,inactive],emitTabsChanged(){updates++}}
    assert.equal(tileAiTerminals(app),true)
    assert.deepEqual(split.root.getAllTabs(),[source,editor,...ai])
    assert.equal(split.root.children[1].children.length,2)
    assert.deepEqual(split.root.children[1].children.map((row:any)=>row.children.length),[2,2])
    assert.equal(focused,ai[2]);assert.equal(maximized,null);assert.equal(layouts,1);assert.equal(updates,1)
    assert.equal(inactive.children.length,1)
    assert.equal(tileAiTerminals(app),true);assert.deepEqual(split.root.getAllTabs(),[source,editor,...ai])
    app.activeTab=null;assert.equal(tileAiTerminals(app),false)
    app.activeTab={...split,root:new Container([source,ai[0]])};assert.equal(tileAiTerminals(app),false)
})

test('automatic tiling responds to added and removed panes without reflowing on resize or focus',async()=>{
    const {AutomaticAiTiling}=await import('../src/arw-ai-cli/tiling'),{Subject}=await import('rxjs')
    const changed=new Subject<void>(),source={name:'SSH'},ai=Array.from({length:4},()=>({profile:{options:{env:{ARW_WORKSPACE_ROOT:'/project'}}}}))
    let layouts=0
    const split={root:new Container([source,...ai]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>ai[0],focus(){throw Error('Background tiling must not take focus')},maximize(){},layout(){layouts++}}
    const app:any={tabs:[split],activeTab:null,tabsChanged$:changed,emitTabsChanged(){changed.next()}}
    const automatic=new AutomaticAiTiling(app,error=>{throw error}),tick=()=>new Promise(resolve=>setTimeout(resolve,10))
    try{
        await tick();assert.equal(layouts,1,'restored panes arrange even before their tab is selected')
        changed.next();await tick();assert.equal(layouts,1,'unchanged pane membership preserves manual sizing')
        split.root=new Container([source,...ai.slice(0,3)]);changed.next();await tick();assert.equal(layouts,2)
        split.root=new Container([source,ai[0]]);changed.next();await tick();assert.equal(layouts,3)
        automatic.dispose();changed.next();await tick();assert.equal(layouts,3)
    }finally{automatic.dispose()}
})
