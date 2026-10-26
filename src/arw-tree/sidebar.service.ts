import { SCROLLBAR_STYLES } from '../shared/scrollbar-styles'
import { SPLIT_DIVIDER_STYLES } from '../shared/split-divider-styles'
import { t } from '../shared/i18n'
import { ApplicationRef, ComponentFactoryResolver, ComponentRef, Injectable, Injector, NgZone } from '@angular/core'
import { AppService, ConfigService, NotificationsService } from 'tabby-core'
import { ArwTreeComponent } from './tree.component'
import { applyArwFont } from './fonts'
import { ArwEditorComponent } from './editor.component'
import { ArwPreviewComponent } from './preview.component'

/** Owns the single host DOM insertion point; feature components use Angular. */
@Injectable()
export class SidebarService {
    private component?: ComponentRef<ArwTreeComponent>
    private host?: HTMLElement
    private container?: HTMLElement
    private visible = true
    private installed = false
    private focusSubscription?:{unsubscribe():void}
    private subscriptions:Array<{unsubscribe():void}>=[]
    constructor (private app: AppService, private application: ApplicationRef, private resolver: ComponentFactoryResolver,
        private injector: Injector, private zone: NgZone, private notifications: NotificationsService,
        private config?: ConfigService) { }
    install (): void {
        if(this.installed)return
        this.installed=true
        this.subscriptions.push(this.app.activeTabChange$.subscribe(()=>this.watchActiveTab()))
        this.watchActiveTab()
        this.app.ready$.subscribe(()=>this.mount())
    }
    private mount (attempt=0):void {
        if(this.component)return
        const content=document.querySelector<HTMLElement>('app-root tab-body')?.parentElement
            ?? document.querySelector<HTMLElement>('app-root start-page')?.parentElement
            ?? document.querySelector<HTMLElement>('app-root .content.main > .content')
        if(!content){
            if(attempt<20)setTimeout(()=>this.mount(attempt+1),100)
            else this.notifications.error(t('ARW：未找到兼容的工作区侧栏挂载位置'))
            return
        }
        this.zone.run(()=>{
            this.component=this.resolver.resolveComponentFactory(ArwTreeComponent).create(this.injector)
            this.application.attachView(this.component.hostView)
            const host=this.component.location.nativeElement as HTMLElement
            this.host=host
            host.classList.add('arw-tree-host')
            this.applyFont()
            const apply=()=>this.applyFont()
            if(this.config) {
                this.subscriptions.push(this.config.changed$.subscribe(apply))
                this.subscriptions.push(this.config.ready$.subscribe(apply))
            }
            Object.assign(host.style,{position:'absolute',left:'0',top:'0',bottom:'0',width:'var(--arw-sidebar-width,300px)',zIndex:'20'})
            const style=document.createElement('style')
            style.textContent='.arw-tree-layout > .content-tab-active{margin-left:var(--arw-sidebar-width,300px)!important;width:calc(100% - var(--arw-sidebar-width,300px))!important}.arw-tree-resizer:hover,.arw-tree-resizer:focus{background:#73a9ed55!important}'+SPLIT_DIVIDER_STYLES+SCROLLBAR_STYLES
            host.append(style)
            content.classList.add('arw-tree-layout');content.prepend(host)
            this.container=content
            this.component.changeDetectorRef.detectChanges()
            const resize=document.createElement('div')
            resize.className='arw-tree-resizer'
            resize.tabIndex=0
            resize.setAttribute('role','separator')
            resize.setAttribute('aria-label',t('调整 ARW 侧栏宽度'))
            resize.setAttribute('aria-orientation','vertical')
            Object.assign(resize.style,{position:'absolute',right:'0',top:'0',bottom:'0',width:'5px',cursor:'col-resize',touchAction:'none',zIndex:'2'})
            let width=300
            const update=(value:number)=>{
                width=Math.max(240,Math.min(Math.max(240,Math.min(520,window.innerWidth-200)),value))
                content.style.setProperty('--arw-sidebar-width',`${width}px`)
                resize.setAttribute('aria-valuenow',String(width))
            }
            try{const saved=Number(localStorage.getItem('arw.sidebar.width'));if(Number.isFinite(saved)&&saved>=240)width=saved}catch{}
            update(width)
            const save=()=>{try{localStorage.setItem('arw.sidebar.width',String(width))}catch{}}
            resize.onpointerdown=event=>{
                if(event.button!==0)return
                event.preventDefault()
                const initial=width,start=event.clientX
                const move=(next:PointerEvent)=>update(initial+next.clientX-start)
                const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);save()}
                window.addEventListener('pointermove',move)
                window.addEventListener('pointerup',end,{once:true})
                window.addEventListener('pointercancel',end,{once:true})
            }
            resize.onkeydown=event=>{
                if(!['ArrowLeft','ArrowRight'].includes(event.key))return
                event.preventDefault();update(width+(event.key==='ArrowRight'?10:-10));save()
            }
            host.append(resize)
            this.updateVisibility()
        })
    }
    private applyFont():void {
        const terminal=this.config?.store?.terminal
        applyArwFont(this.host,terminal)
        applyArwFont(document.documentElement,terminal)
    }
    toggle ():void {
        this.visible=!this.visible
        if(!this.component)this.mount()
        this.updateVisibility()
    }
    private updateVisibility():void {
        const tab=this.app.activeTab
        const focused=tab&&'getFocusedTab' in tab?((tab as any).getFocusedTab()??(tab as any).getAllTabs?.()[0]):tab
        const isFile=(pane:unknown)=>pane instanceof ArwEditorComponent||pane instanceof ArwPreviewComponent
        const hasTerminal=tab&&'getAllTabs' in tab&&(tab as any).getAllTabs().some((pane:unknown)=>!isFile(pane))
        const visible=this.visible&&(!isFile(focused)||Boolean(hasTerminal))
        if(this.host)this.host.style.display=visible?'':'none'
        this.container?.classList.toggle('arw-tree-layout',visible)
    }
    private watchActiveTab():void {
        this.focusSubscription?.unsubscribe()
        const tab=this.app.activeTab
        this.focusSubscription=tab&&'focusChanged$' in tab?(tab as any).focusChanged$.subscribe(()=>this.updateVisibility()):undefined
        this.updateVisibility()
    }
}
