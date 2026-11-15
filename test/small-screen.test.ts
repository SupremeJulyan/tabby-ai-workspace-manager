import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { Subject } from 'rxjs'
import { SmallScreenController } from '../src/arw-tree/small-screen'
import { paneScreenLayer, selectedScreenLayer } from '../src/shared/small-screen'

class Container {
    orientation='h';children:any[]=[];ratios:number[]=[]
    constructor(children:any[]=[]){this.children=children;this.ratios=children.map(()=>1/children.length)}
    getAllTabs():any[]{return this.children.flatMap(child=>child instanceof Container?child.getAllTabs():[child])}
}
const area=(node:any,pane:any,weight=1):number=>node instanceof Container?node.children.reduce((sum,child,index)=>sum+area(child,pane,weight*node.ratios[index]),0):node===pane?weight:0

test('three full-size layers switch without replacing sessions, follow new files, and restore on disable',async()=>{
    const window=new Window(),previous=globalThis.document
    globalThis.document=window.document as any
    const tick=()=>new Promise(resolve=>setTimeout(resolve,15))
    const changes=new Subject<void>(),active=new Subject<void>(),focus=new Subject<any>(),configChanges=new Subject<void>()
    const container=document.createElement('div');document.body.append(container)
    const make=(fields:any)=>{const host=document.createElement('div');container.append(host);return {...fields,hostView:{rootNodes:[host]},destroy(){throw Error('Sessions must survive switching')}}}
    const source=make({profile:{options:{}}}),file=make({arwFilePane:true}),ai=make({profile:{options:{env:{ARW_WORKSPACE_ROOT:'/project'}}}})
    let focused:any=source
    const split:any={root:new Container([source,file,ai]),getAllTabs(){return this.root.getAllTabs()},getFocusedTab:()=>focused,focus(pane:any){focused=pane;focus.next(pane)},focusChanged$:focus,maximize(){},layout(){}}
    const app:any={tabs:[split],activeTab:split,activeTabChange$:active,tabsChanged$:changes,emitTabsChanged(){changes.next()}}
    const config:any={store:{omw:{smallScreen:true}},changed$:configChanges}
    const controller=new SmallScreenController(app,config,container,()=>{})
    const click=(index:number)=>(container.querySelectorAll('.arw-layer-nav button')[index] as HTMLButtonElement).click()
    try{
        await tick()
        assert.equal(area(split.root,file),1);assert.equal(area(split.root,source),0)
        // Native delete confirmations and context menus restore main-terminal focus.
        // Keep the explorer visible, including when a confirmation is cancelled.
        for(let i=0;i<2;i++){
            split.focus(source);await tick()
            assert.equal(selectedScreenLayer(split),'files')
            assert.equal(controller.layer,'files')
            assert.equal(area(split.root,file),1)
            assert.equal(source.hostView.rootNodes[0].classList.contains('arw-layer-hidden'),true)
        }
        click(1);await tick()
        assert.equal(area(split.root,source),1);assert.equal(area(split.root,file),0)
        assert.equal(file.hostView.rootNodes[0].classList.contains('arw-layer-hidden'),true)
        click(2);await tick()
        assert.equal(area(split.root,ai),1);assert.equal(focused,ai)
        split.focus(source);await tick()
        assert.equal(selectedScreenLayer(split),'ai')
        assert.equal(area(split.root,ai),1)
        // Opening a file focuses its layer automatically.
        const next=make({arwFilePane:true});split.root.children.push(next);split.root.ratios.push(0)
        split.focus(next);changes.next();await tick()
        assert.equal(selectedScreenLayer(split),'files')
        assert.equal(paneScreenLayer(next),'files')
        assert.ok(area(split.root,next)>0)
        // Gestures stay available to the content and never switch layers.
        const wheel=new window.WheelEvent('wheel',{deltaX:90,deltaY:0,cancelable:true})
        container.dispatchEvent(wheel as any)
        container.dispatchEvent(new window.PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:1,clientX:180,clientY:50}) as any)
        container.dispatchEvent(new window.PointerEvent('pointerup',{pointerType:'touch',isPrimary:true,pointerId:1,clientX:50,clientY:55}) as any)
        await tick()
        assert.equal(selectedScreenLayer(split),'files');assert.equal(wheel.defaultPrevented,false)
        click(2);await tick()
        // Removing the last AI pane leaves an explicit empty layer with finite geometry.
        const remove=(node:Container):void=>{for(let i=node.children.length-1;i>=0;i--){if(node.children[i]===ai){node.children.splice(i,1);node.ratios.splice(i,1)}else if(node.children[i] instanceof Container)remove(node.children[i])}}
        remove(split.root);changes.next();await tick()
        assert.equal((container.querySelector('.arw-layer-empty') as HTMLElement).hidden,false)
        assert.ok(Number.isFinite(area(split.root,source)))
        // Put the same running session back, then leave the mode.
        split.root.children.push(ai);split.root.ratios.push(0);changes.next();await tick()
        config.store.omw.smallScreen=false;configChanges.next();await tick()
        assert.equal(container.classList.contains('arw-small-screen'),false)
        assert.ok(area(split.root,file)>0);assert.ok(area(split.root,source)>0);assert.ok(area(split.root,ai)>0)
        assert.equal(container.querySelectorAll('.arw-layer-hidden').length,0)
        assert.deepEqual(new Set(split.getAllTabs()),new Set([source,file,ai,next]))
    }finally{controller.dispose();globalThis.document=previous;await window.happyDOM.close()}
})
