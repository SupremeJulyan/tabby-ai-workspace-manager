import test from 'node:test'
import assert from 'node:assert/strict'
import { openAdjacentTab, placeAdjacentTab } from '../src/shared/open-adjacent-tab'

function fixture (wrapped:boolean) {
    const left={},anchor={},right={},opened={},wrapper={}
    const tabs=[left,anchor,right]
    let notifications=0
    const app:any={tabs,activeTab:anchor,
        openNewTab(){tabs.push(wrapped?wrapper:opened);this.activeTab=wrapped?wrapper:opened;return opened},
        getParentTab(tab:object){return wrapped&&tab===opened?wrapper:null},
        emitTabsChanged(){notifications++},
    }
    return {app,left,anchor,right,opened,wrapper,notifications:()=>notifications}
}

test('new file tabs appear immediately before the active tab instead of the end',()=>{
    const f=fixture(false)
    assert.equal(openAdjacentTab(f.app,{type:class {} as any}),f.opened)
    assert.deepEqual(f.app.tabs,[f.left,f.opened,f.anchor,f.right])
    assert.equal(f.app.activeTab,f.opened)
    assert.equal(f.notifications(),1)
})

test('wrapped file tabs move their top-level container and retain focus',()=>{
    const f=fixture(true)
    openAdjacentTab(f.app,{type:class {} as any})
    assert.deepEqual(f.app.tabs,[f.left,f.wrapper,f.anchor,f.right])
    assert.equal(f.app.activeTab,f.wrapper)
})

test('split-pane anchors resolve to their containing top-level tab',()=>{
    const f=fixture(true),pane={}
    f.app.activeTab=pane
    const original=f.app.getParentTab
    f.app.getParentTab=(tab:object)=>tab===pane?f.anchor:original(tab)
    openAdjacentTab(f.app,{type:class {} as any})
    assert.deepEqual(f.app.tabs,[f.left,f.wrapper,f.anchor,f.right])
})

test('closing the anchor during opening leaves the new tab at the normal fallback position',()=>{
    const f=fixture(false),original=f.app.openNewTab
    f.app.openNewTab=function(){this.tabs.splice(this.tabs.indexOf(f.anchor),1);return original.call(this)}
    openAdjacentTab(f.app,{type:class {} as any})
    assert.deepEqual(f.app.tabs,[f.left,f.right,f.opened])
    assert.equal(f.notifications(),0)
})


test('AI tabs move their wrapper immediately to the right of the captured anchor',()=>{
    const f=fixture(true),pane={}
    const original=f.app.getParentTab
    f.app.getParentTab=(tab:object)=>tab===pane?f.anchor:original(tab)
    f.app.openNewTab()
    placeAdjacentTab(f.app,f.opened,pane,'right')
    assert.deepEqual(f.app.tabs,[f.left,f.anchor,f.wrapper,f.right])
    assert.equal(f.app.activeTab,f.wrapper)
    assert.equal(f.notifications(),1)
})

test('right-adjacent movement calculates the insertion index after removing the target',()=>{
    const f=fixture(false)
    f.app.tabs.unshift(f.opened)
    placeAdjacentTab(f.app,f.opened,f.anchor,'right')
    assert.deepEqual(f.app.tabs,[f.left,f.anchor,f.opened,f.right])
})
