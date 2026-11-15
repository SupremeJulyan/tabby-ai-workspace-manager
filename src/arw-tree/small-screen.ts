import type { AppService, BaseTabComponent, ConfigService, SplitTabComponent } from 'tabby-core'
import { tileWorkspacePanes } from '../arw-ai-cli/tiling'
import { collapsedAiPanes } from '../arw-ai-cli/collapsed-panes'
import { stackedHiddenPanes } from '../shared/pane-layout'
import { workspaceHiddenPanes } from '../shared/workspace-pane-visibility'
import { paneScreenLayer, registerSmallScreen, screenLayers, selectedScreenLayer, selectScreenLayer, type ScreenLayer } from '../shared/small-screen'
import { observeArwLocale, t } from '../shared/i18n'

function paneHost(tab: BaseTabComponent): HTMLElement | undefined {
    const direct=(tab as BaseTabComponent & {element?:{nativeElement?:HTMLElement}}).element?.nativeElement
    return direct ?? (tab.viewContainerEmbeddedRef ?? tab.hostView as {rootNodes?:HTMLElement[]})?.rootNodes?.find((node:HTMLElement)=>node.nodeType===1)
}

/** Changes only presentation: every terminal and editor stays in its original split. */
export class SmallScreenController {
    active=false
    layer: ScreenLayer='files'
    private nav=document.createElement('nav')
    private empty=document.createElement('div')
    private subscriptions:Array<{unsubscribe():void}>=[]
    private focusSubscription?:{unsubscribe():void}
    private unregister:()=>void
    private stopLocale:()=>void
    private timer?:ReturnType<typeof setTimeout>
    private arranging=false
    private previousEnabled=false
    private signature=''
    private paneIds=new WeakMap<object,number>()
    private nextId=0
    private current?:BaseTabComponent
    private touched=new Set<HTMLElement>()

    constructor(private app:AppService,private config:ConfigService|undefined,private container:HTMLElement,private changed:()=>void){
        this.unregister=registerSmallScreen(app,()=>this.config?.store.omw?.smallScreen===true)
        this.nav.className='arw-layer-nav'
        this.empty.className='arw-layer-empty'
        this.empty.setAttribute('role','status')
        container.append(this.nav,this.empty)
        this.stopLocale=observeArwLocale(()=>this.render())
        this.subscriptions.push(app.activeTabChange$.subscribe(()=>this.watch()))
        this.subscriptions.push(app.tabsChanged$.subscribe(()=>this.schedule()))
        if(config)this.subscriptions.push(config.changed$.subscribe(()=>this.schedule()))
        this.watch()
    }
    private watch():void {
        this.focusSubscription?.unsubscribe()
        this.signature=''
        this.current=this.app.activeTab??undefined
        if(this.current&&'focusChanged$' in this.current){
            this.focusSubscription=(this.current as SplitTabComponent).focusChanged$.subscribe(pane=>{
                if(!this.active||this.arranging||!pane)return
                selectScreenLayer(this.current!,paneScreenLayer(pane))
                this.schedule()
            })
        }
        this.schedule()
    }
    private schedule():void {
        if(this.timer!==undefined)return
        this.timer=setTimeout(()=>{this.timer=undefined;this.refresh()},0)
    }
    private panes():BaseTabComponent[]{
        const tab=this.app.activeTab
        return tab?('getAllTabs' in tab?(tab as SplitTabComponent).getAllTabs():[tab]):[]
    }
    private refresh():void {
        const enabled=this.config?.store.omw?.smallScreen===true
        const panes=this.panes(),tab=this.app.activeTab
        this.active=enabled&&panes.some(pane=>Boolean((pane as any).profile)||(pane as any).arwFilePane)
        this.layer=tab?selectedScreenLayer(tab):'files'
        const signature=`${this.active}:${this.layer}:${panes.map(pane=>{if(!this.paneIds.has(pane))this.paneIds.set(pane,++this.nextId);return this.paneIds.get(pane)}).join(',')}`
        this.arranging=true
        try{
            // Restore all open splits on leaving the mode, including background tabs.
            if(this.previousEnabled&&!enabled){
                for(const top of this.app.tabs)if('getAllTabs' in top)tileWorkspacePanes(this.app,top as SplitTabComponent,true)
            }
            if(this.active&&tab&&'getAllTabs' in tab&&(signature!==this.signature||tab!==this.current))tileWorkspacePanes(this.app,tab as SplitTabComponent,true)
            this.signature=signature
            this.previousEnabled=enabled
            for(const host of this.touched)host.classList.remove('arw-layer-hidden')
            this.touched.clear()
            if(this.active)for(const pane of panes){
                const host=paneHost(pane)
                if(host){host.classList.toggle('arw-layer-hidden',paneScreenLayer(pane)!==this.layer);this.touched.add(host)}
            }
            this.container.classList.toggle('arw-small-screen',this.active)
            this.render()
            this.changed()
        }finally{this.arranging=false}
    }
    private render():void {
        this.nav.hidden=!this.active
        this.empty.hidden=true
        if(!this.active)return
        const labels=[t('文件与侧栏'),t('主终端'),t('AI 终端')]
        this.nav.setAttribute('aria-label',t('小屏模式'))
        this.nav.replaceChildren(...screenLayers.map((layer,index)=>{
            const button=document.createElement('button')
            button.type='button';button.textContent=labels[index]
            button.setAttribute('aria-pressed',String(this.layer===layer))
            button.onclick=()=>this.select(layer)
            return button
        }))
        if(this.layer!=='files'&&!this.panes().some(pane=>paneScreenLayer(pane)===this.layer&&!workspaceHiddenPanes.has(pane)&&!collapsedAiPanes.has(pane)&&!stackedHiddenPanes.has(pane))){
            this.empty.textContent=this.layer==='ai'?t('暂无 AI 终端'):t('暂无主终端')
            this.empty.hidden=false
        }
    }
    private select(layer:ScreenLayer):void {
        const tab=this.app.activeTab
        if(!this.active||!tab)return
        selectScreenLayer(tab,layer)
        this.refresh()
        const pane=this.panes().find(pane=>paneScreenLayer(pane)===layer&&!workspaceHiddenPanes.has(pane)&&!collapsedAiPanes.has(pane)&&!stackedHiddenPanes.has(pane))
        if(pane&&'focus' in tab&&'getAllTabs' in tab){
            this.arranging=true
            try{(tab as SplitTabComponent).focus(pane)}finally{this.arranging=false}
        }
    }
    dispose():void {
        clearTimeout(this.timer);this.focusSubscription?.unsubscribe()
        this.subscriptions.forEach(subscription=>subscription.unsubscribe())
        this.unregister();this.stopLocale()
        this.nav.remove();this.empty.remove()
        this.container.classList.remove('arw-small-screen')
        for(const host of this.touched)host.classList.remove('arw-layer-hidden')
    }
}

export const SMALL_SCREEN_STYLES=`
.arw-layer-nav[hidden],.arw-layer-empty[hidden],.arw-layer-hidden{display:none!important}
.arw-layer-nav{position:absolute;top:0;left:0;right:0;height:32px;display:flex;justify-content:center;gap:4px;z-index:25;background:var(--theme-bg,#23262d);border-bottom:1px solid #8883}
.arw-layer-nav button{font:inherit;font-size:12px;color:inherit;background:transparent;border:0;border-bottom:2px solid transparent;padding:3px 16px;cursor:pointer}
.arw-layer-nav button[aria-pressed=true]{border-bottom-color:#73a9ed;background:#73a9ed18}
.arw-layer-nav button:focus-visible{outline:2px solid #73a9ed;outline-offset:-2px}
.arw-small-screen>.arw-tree-host{top:32px!important}
.arw-small-screen>.content-tab-active{top:32px!important;height:calc(100% - 32px)!important}
.arw-small-screen split-tab>split-tab-spanner{display:none!important}
.arw-layer-empty{position:absolute;inset:32px 0 0;display:grid;place-items:center;pointer-events:none;opacity:.6;font-size:13px}
`
