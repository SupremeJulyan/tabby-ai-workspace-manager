import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { addAiCloseButton, addFileCloseButton } from '../src/arw-ai-cli/close-button'

test('file header shares AI controls and respects unsaved-file cancellation',async()=>{
    const window=new Window(),host=window.document.createElement('div')
    let allow=false,closed=0
    const tab:any={arwFilePane:true,title:'Edit · example.ts',hostView:{rootNodes:[host]},canClose:async()=>allow,destroy(){closed++}}
    const app:any={tabs:[],getParentTab:()=>({getAllTabs:()=>[tab]})}
    const cleanup=addFileCloseButton(tab,app,error=>{throw error})!
    try{
        assert.equal(host.querySelector('.arw-ai-header span')?.textContent,tab.title)
        assert.ok(host.querySelector('.arw-ai-toggle-button'))
        assert.ok(host.querySelector('.arw-ai-expand-button'))
        const header=host.querySelector<HTMLElement>('.arw-ai-header')!
        assert.equal(header.style.gridTemplateColumns,'22px minmax(0, 1fr) auto 22px')
        assert.equal(host.querySelector<HTMLElement>('.arw-ai-toggle-button')!.style.gridColumn,'1')
        assert.equal(host.querySelector<HTMLElement>('.arw-ai-close-button')!.style.gridColumn,'4')
        assert.equal(host.querySelector<HTMLElement>('.arw-ai-expand-button')!.style.display,'none')
        const button=host.querySelector<HTMLButtonElement>('.arw-ai-close-button')!
        button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,0)
        allow=true;button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,1)
    }finally{cleanup();await window.happyDOM.close()}
})

test('AI close button respects cancellation, closes only its split pane, and detaches cleanly',async()=>{
    const window=new Window(),host=window.document.createElement('div');window.document.body.append(host)
    let allow=false,closed=0,sourceClosed=0
    const tab:any={profile:{options:{env:{ARW_WORKSPACE_ROOT:'/project',ARW_WORKSPACE_NAME:'我的项目'}}},element:{nativeElement:host},canClose:async()=>allow,destroy(){closed++},effectivelyPinned:false}
    const source={destroy(){sourceClosed++}},app:any={tabs:[],getParentTab:()=>({getAllTabs:()=>[source,tab]})}
    const cleanup=addAiCloseButton(tab,app,error=>{throw error})!
    assert.equal(host.querySelector('.arw-ai-header span')?.textContent,'Local · project')
    assert.equal(host.firstElementChild?.className,'arw-ai-header')
    const toggle=host.querySelector<HTMLButtonElement>('.arw-ai-toggle-button')!
    assert.equal(toggle.disabled,true,'the last visible AI pane keeps recovery controls accessible')
    const button=host.querySelector<HTMLButtonElement>('.arw-ai-close-button')!
    button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,0)
    allow=true;tab.effectivelyPinned=true;button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,0)
    tab.effectivelyPinned=false;button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,1);assert.equal(sourceClosed,0)
    cleanup();assert.equal(host.querySelector('button'),null)
    assert.equal(addAiCloseButton({...tab,profile:{options:{env:{}}}},app,()=>{}),undefined)
    await window.happyDOM.close()
})

test('collapsing AI panes releases their layout area and increments the adjacent restore count',async()=>{
    const {Subject}=await import('rxjs')
    const {tileAiTerminals}=await import('../src/arw-ai-cli/tiling')
    const {collapsedAiPanes}=await import('../src/arw-ai-cli/collapsed-panes')
    class Container {
        orientation='h';children:any[]=[];ratios:number[]=[]
        constructor(children:any[]=[]){this.children=children;this.ratios=children.map(()=>1/children.length)}
        getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
    }
    const window=new Window(),changed=new Subject<void>(),source={}
    const panes=Array.from({length:3},(_,index)=>{
        const host=window.document.createElement('div');window.document.body.append(host)
        return {element:{nativeElement:host},profile:{options:{env:{ARW_WORKSPACE_ROOT:`/workspace${index}`}}},canClose:async()=>true,destroy(){throw Error('Collapse must preserve the session')}}
    })
    let focused:any=panes[0]
    const split:any={root:new Container([source,...panes]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(value:any){focused=value},maximize(){},layout(){}}
    const app:any={tabs:[split],activeTab:split,getParentTab:()=>split,tabsChanged$:changed,emitTabsChanged(){changed.next()}}
    const cleanups=panes.map(pane=>addAiCloseButton(pane as any,app,error=>{throw error})!)
    const click=(index:number,selector:string)=>panes[index].element.nativeElement.querySelector<HTMLButtonElement>(selector)!.click()
    const count=(index:number)=>panes[index].element.nativeElement.querySelector('.arw-ai-expand-button')!.textContent
    const area=(node:any,pane:any,weight=1):number=>node instanceof Container?node.children.reduce((sum,child,index)=>sum+area(child,pane,weight*node.ratios[index]),0):node===pane?weight:0
    try{
        click(0,'.arw-ai-toggle-button')
        assert.equal(area(split.root,panes[0]),0)
        assert.equal(count(1),'1');assert.equal(focused,panes[1])
        assert.ok(panes[0].element.nativeElement.classList.contains('arw-ai-collapsed'))
        click(1,'.arw-ai-toggle-button')
        assert.equal(area(split.root,panes[1]),0)
        assert.equal(count(2),'2')
        assert.equal(area(split.root,panes[2]),.5)
        tileAiTerminals(app,split,true)
        assert.equal(area(split.root,panes[0]),0,'automatic retiling preserves collapsed panes')
        click(2,'.arw-ai-expand-button')
        assert.equal(count(2),'0')
        assert.equal(count(1),'1')
        assert.equal(panes.filter(pane=>collapsedAiPanes.has(pane)).length,1)
        click(1,'.arw-ai-expand-button')
        assert.ok(panes.every(pane=>area(split.root,pane)>0))
        assert.equal(split.getAllTabs().length,4)
        assert.equal(count(2),'0')
    }finally{cleanups.forEach(cleanup=>cleanup());await window.happyDOM.close()}
})
