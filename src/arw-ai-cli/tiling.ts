import { stackedGroup, stackedHiddenPanes, selectedStackedPane, selectStackedPane } from '../shared/pane-layout'
import type { WorkspacePaneKind } from '../shared/pane-kind'
import { collapsedAiPanes, orderedAiPanes } from './collapsed-panes'
import { orderedFilePanes } from './collapsed-panes'
import { isAiPane, isFilePane } from '../shared/pane-kind'
import type { AppService, BaseTabComponent, SplitContainer, SplitTabComponent } from 'tabby-core'

/** Rebuild workspace containers only; terminal sessions and file instances remain intact. */
export function tileWorkspacePanes(app:AppService,target?:SplitTabComponent,allowSingle=false):boolean {
    const active=target??app.activeTab
    if(!active)return false
    const split=('getAllTabs' in active?active:app.getParentTab(active)) as SplitTabComponent|null
    if(!split?.root||typeof split.layout!=='function')return false
    const tabs=split.getAllTabs()
    const ai=orderedAiPanes(split,tabs.filter(isAiPane))
    const files=orderedFilePanes(split,tabs.filter(isFilePane))
    if(files.length===0&&ai.length<(allowSingle?1:2))return false
    const Constructor=split.root.constructor as new()=>SplitContainer,managed=new Set<BaseTabComponent>([...ai,...files])
    const container=(orientation:'h'|'v',children:(BaseTabComponent|SplitContainer)[],ratios=children.map(()=>1/children.length))=>{
        const result=new Constructor();result.orientation=orientation;result.children=children;result.ratios=ratios;return result
    }
    const keepOthers=(node:BaseTabComponent|SplitContainer):BaseTabComponent|SplitContainer|undefined=>{
        if(!(node instanceof Constructor))return managed.has(node as BaseTabComponent)?undefined:node
        const kept=node.children.map((child,index)=>({node:keepOthers(child),ratio:node.ratios[index]??1})).filter(item=>item.node!==undefined)
        if(!kept.length)return
        if(kept.length===1)return kept[0].node
        const total=kept.reduce((sum,item)=>sum+item.ratio,0)
        return container(node.orientation,kept.map(item=>item.node!),kept.map(item=>total>0?item.ratio/total:1/kept.length))
    }
    const paneGrid=(panes:BaseTabComponent[],kind:WorkspacePaneKind)=>{
        if(panes.length&&stackedGroup(panes)){
            const selected=selectedStackedPane(split,kind,panes)??panes[0]
            selectStackedPane(split,kind,selected,panes)
            for(const pane of panes){
                collapsedAiPanes.delete(pane)
                if(pane===selected)stackedHiddenPanes.delete(pane)
                else stackedHiddenPanes.add(pane)
            }
            return container('h',panes,panes.map(pane=>pane===selected?1:0))
        }
        for(const pane of panes)stackedHiddenPanes.delete(pane)
        const visible=panes.filter(tab=>!collapsedAiPanes.has(tab)),hidden=panes.filter(tab=>collapsedAiPanes.has(tab))
        if(!visible.length)return
        const columns=Math.ceil(Math.sqrt(visible.length)),rows:SplitContainer[]=[]
        for(let index=0;index<visible.length;index+=columns)rows.push(container('h',visible.slice(index,index+columns)))
        const visibleGrid=container('v',rows)
        return hidden.length?container('h',[visibleGrid,...hidden],[1,...hidden.map(()=>0)]):visibleGrid
    }
    const fileGrid=paneGrid(files,'file'),aiGrid=paneGrid(ai,'ai'),others=keepOthers(split.root)
    const workspace=fileGrid&&others?container('v',[fileGrid,others],[.6,.4]):fileGrid??others
    const root=workspace&&aiGrid?container('h',[workspace,aiGrid],[.68,.32]):workspace??aiGrid
    if(!root)return false
    const focused=split.getFocusedTab()
    split.maximize(null)
    split.root=root instanceof Constructor?root:container('h',[root])
    split.layout()
    if(focused&&(app.activeTab===split||app.activeTab===focused)){
        const replacement=isFilePane(focused)?files.find(tab=>!collapsedAiPanes.has(tab)):isAiPane(focused)?ai.find(tab=>!collapsedAiPanes.has(tab)):focused
        const stackedReplacement=isFilePane(focused)?selectedStackedPane(split,'file',files):isAiPane(focused)?selectedStackedPane(split,'ai',ai):focused
        split.focus(stackedHiddenPanes.has(focused)?stackedReplacement??focused:collapsedAiPanes.has(focused)?replacement??focused:focused)
    }
    app.emitTabsChanged()
    return true
}

/** Backwards-compatible entry point for callers that only arrange AI panes. */
export function tileAiTerminals(app:AppService,target?:SplitTabComponent,allowSingle=false):boolean {
    return tileWorkspacePanes(app,target,allowSingle)
}


/** Reflow on pane membership changes, never on focus changes or manual resizing. */
export class AutomaticAiTiling {
    private snapshots=new Map<SplitTabComponent,{tabs:BaseTabComponent[];aiCount:number;fileCount:number}>()
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
                const aiCount=tabs.filter(isAiPane).length,fileCount=tabs.filter(isFilePane).length
                if(fileCount>0||aiCount>=2||(aiCount===1&&(previous?.aiCount??0)>=2)||(fileCount===0&&(previous?.fileCount??0)>0))tileWorkspacePanes(this.app,split,true)
                this.snapshots.set(split,{tabs:split.getAllTabs(),aiCount,fileCount})
            }
        }catch(error){this.onError(error)}finally{this.arranging=false}
    }
    dispose():void {this.subscription.unsubscribe();clearTimeout(this.timer);this.snapshots.clear()}
}
