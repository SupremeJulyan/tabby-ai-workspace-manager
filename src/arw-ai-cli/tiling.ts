import { collapsedAiPanes, orderedAiPanes } from './collapsed-panes'
import type { AppService, BaseTabComponent, SplitContainer, SplitTabComponent } from 'tabby-core'

/** Rebuild layout containers only; all terminal instances and sessions remain intact. */
export function tileAiTerminals(app:AppService,target?:SplitTabComponent,allowSingle=false):boolean {
    const active=target??app.activeTab
    if(!active)return false
    const split=('getAllTabs' in active?active:app.getParentTab(active)) as SplitTabComponent|null
    if(!split?.root||typeof split.layout!=='function')return false
    const tabs=split.getAllTabs(),ai=orderedAiPanes(split,tabs.filter(tab=>Boolean((tab as BaseTabComponent&{profile?:{options?:{env?:Record<string,string>}}}).profile?.options?.env?.ARW_WORKSPACE_ROOT)))
    if(ai.length<(allowSingle?1:2))return false
    const Constructor=split.root.constructor as new()=>SplitContainer,aiSet=new Set(ai)
    const container=(orientation:'h'|'v',children:(BaseTabComponent|SplitContainer)[],ratios=children.map(()=>1/children.length))=>{
        const result=new Constructor();result.orientation=orientation;result.children=children;result.ratios=ratios;return result
    }
    const keepOthers=(node:BaseTabComponent|SplitContainer):BaseTabComponent|SplitContainer|undefined=>{
        if(!(node instanceof Constructor))return aiSet.has(node as BaseTabComponent)?undefined:node
        const kept=node.children.map((child,index)=>({node:keepOthers(child),ratio:node.ratios[index]??1})).filter(item=>item.node!==undefined)
        if(!kept.length)return
        if(kept.length===1)return kept[0].node
        const total=kept.reduce((sum,item)=>sum+item.ratio,0)
        return container(node.orientation,kept.map(item=>item.node!),kept.map(item=>total>0?item.ratio/total:1/kept.length))
    }
    const visible=ai.filter(tab=>!collapsedAiPanes.has(tab)),hidden=ai.filter(tab=>collapsedAiPanes.has(tab))
    if(!visible.length)return false
    const columns=Math.ceil(Math.sqrt(visible.length)),rows:SplitContainer[]=[]
    for(let index=0;index<visible.length;index+=columns)rows.push(container('h',visible.slice(index,index+columns)))
    const visibleGrid=container('v',rows)
    const grid=hidden.length?container('h',[visibleGrid,...hidden],[1,...hidden.map(()=>0)]):visibleGrid
    const others=keepOthers(split.root),focused=split.getFocusedTab()
    split.maximize(null)
    split.root=others?container('h',[others,grid],[.28,.72]):grid
    split.layout()
    if(focused&&(app.activeTab===split||app.activeTab===focused))split.focus(collapsedAiPanes.has(focused)?visible[0]:focused)
    app.emitTabsChanged()
    return true
}


/** Reflow on pane membership changes, never on focus changes or manual resizing. */
export class AutomaticAiTiling {
    private snapshots=new Map<SplitTabComponent,{tabs:BaseTabComponent[];count:number}>()
    private timer?:ReturnType<typeof setTimeout>
    private arranging=false
    private subscription:{unsubscribe():void}
    constructor(private app:AppService,private onError:(error:unknown)=>void){
        this.subscription=app.tabsChanged$.subscribe(()=>this.schedule())
        this.schedule()
    }
    private schedule():void {
        if(this.timer!==undefined||this.arranging)return
        this.timer=setTimeout(()=>{this.timer=undefined;this.arrange()},0)
    }
    private arrange():void {
        this.arranging=true
        try{
            for(const split of this.snapshots.keys())if(!this.app.tabs.includes(split))this.snapshots.delete(split)
            for(const top of this.app.tabs){
                if(!('getAllTabs' in top)||!('root' in top))continue
                const split=top as SplitTabComponent,tabs=split.getAllTabs(),previous=this.snapshots.get(split)
                if(previous&&previous.tabs.length===tabs.length&&previous.tabs.every((tab,index)=>tab===tabs[index]))continue
                const count=tabs.filter(tab=>Boolean((tab as BaseTabComponent&{profile?:{options?:{env?:Record<string,string>}}}).profile?.options?.env?.ARW_WORKSPACE_ROOT)).length
                if(count>=2||(count===1&&(previous?.count??0)>=2))tileAiTerminals(this.app,split,true)
                this.snapshots.set(split,{tabs:split.getAllTabs(),count})
            }
        }catch(error){this.onError(error)}finally{this.arranging=false}
    }
    dispose():void {this.subscription.unsubscribe();clearTimeout(this.timer);this.snapshots.clear()}
}
