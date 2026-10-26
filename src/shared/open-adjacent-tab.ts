import type { AppService, BaseTabComponent } from 'tabby-core'
import type { NewTabParameters } from 'tabby-core/typings/services/tabs.service'

export function openAdjacentTab<T extends BaseTabComponent> (app:AppService,params:NewTabParameters<T>):T {
    const anchor=app.activeTab
    const opened=app.openNewTab(params)
    placeAdjacentTab(app,opened,anchor)
    return opened
}

export function placeAdjacentTab(app:AppService,opened:BaseTabComponent,anchor:BaseTabComponent|null|undefined,side:'left'|'right'='left'):void {
    if(!anchor||!opened||!app.tabs)return
    const topLevel=(tab:BaseTabComponent):BaseTabComponent=>{
        const visited=new Set<BaseTabComponent>()
        while(!app.tabs.includes(tab)&&!visited.has(tab)){
            visited.add(tab)
            const parent=app.getParentTab(tab)
            if(!parent)break
            tab=parent
        }
        return tab
    }
    const source=topLevel(anchor),target=topLevel(opened)
    const sourceIndex=app.tabs.indexOf(source),targetIndex=app.tabs.indexOf(target)
    if(sourceIndex<0||targetIndex<0||source===target)return
    app.tabs.splice(targetIndex,1)
    app.tabs.splice(app.tabs.indexOf(source)+(side==='right'?1:0),0,target)
    app.emitTabsChanged()
}
