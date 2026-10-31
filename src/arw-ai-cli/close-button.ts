import { workspaceHiddenPanes } from '../shared/workspace-pane-visibility'
import { collapsedAiPanes, orderedAiPanes, orderedFilePanes } from './collapsed-panes'
import { tileWorkspacePanes } from './tiling'
import { t, observeArwLocale } from '../shared/i18n'
import { isAiPane, isFilePane, workspacePaneKind, type WorkspacePaneKind } from '../shared/pane-kind'
import { selectedStackedPane, selectStackedPane, stackedGroup, stackedHiddenPanes } from '../shared/pane-layout'
import type { AppService, BaseTabComponent } from 'tabby-core'
import type { BaseTerminalTabComponent } from 'tabby-terminal'
import { aiPaneTitle, titleAiTabs } from '../shared/workspace-name'

interface PaneControl {tab:BaseTabComponent; app:AppService; kind:WorkspacePaneKind; update:() => void}
type PaneTab=BaseTabComponent&{element?:{nativeElement?:HTMLElement}}
const controls = new Set<PaneControl>()

function paneHost (tab:BaseTabComponent):HTMLElement|undefined {
    const direct=(tab as PaneTab).element?.nativeElement
    if(direct?.ownerDocument)return direct
    const nodes=(tab.viewContainerEmbeddedRef??tab.hostView as {rootNodes?:HTMLElement[]})?.rootNodes??[]
    return nodes.find((node:HTMLElement)=>node.nodeType===1) as HTMLElement|undefined
}

function orderedSiblings (split:{getAllTabs():BaseTabComponent[]},kind:WorkspacePaneKind,panes:BaseTabComponent[]):BaseTabComponent[] {
    return kind==='ai'?orderedAiPanes(split,panes):orderedFilePanes(split,panes)
}

function controlsFor (tab:BaseTabComponent,app:AppService,kind:WorkspacePaneKind):BaseTabComponent[] {
    const split=app.getParentTab(tab)
    const panes=(split?.getAllTabs()??[tab]).filter(item=>workspacePaneKind(item)===kind&&!workspaceHiddenPanes.has(item))
    return split?orderedSiblings(split,kind,panes):panes
}

/** Workspace header for this AI pane, respecting Tabby's process and pinned-tab guards. */
export function addAiCloseButton (tab:BaseTerminalTabComponent<any>,app:AppService,onError:(error:unknown)=>void):(()=>void)|undefined {
    if(!isAiPane(tab))return
    return addPaneCloseButton(tab,app,onError,'ai')
}

/** File panes use the exact same controls and collapse behavior as AI panes. */
export function addFileCloseButton (tab:BaseTabComponent,app:AppService,onError:(error:unknown)=>void):(()=>void)|undefined {
    if(!isFilePane(tab))return
    return addPaneCloseButton(tab,app,onError,'file')
}

function addPaneCloseButton (tab:BaseTabComponent,app:AppService,onError:(error:unknown)=>void,kind:WorkspacePaneKind):(()=>void)|undefined {
    const host=paneHost(tab)
    if(!host?.ownerDocument)return
    const header=host.ownerDocument.createElement('div')
    header.className='arw-ai-header'
    header.dataset.arwPaneKind=kind
    // Match the file header typography for both files and AI terminals.
    Object.assign(header.style,{fontFamily:'var(--bs-body-font-family,sans-serif)',fontSize:'12px',fontWeight:'400',fontStyle:'normal',lineHeight:'var(--arw-line-height,1.45)',letterSpacing:'normal'})
    Object.assign(header.style,{display:'grid',gridTemplateColumns:'22px minmax(0, 1fr) auto 22px',alignItems:'center',flex:'0 0 30px',minHeight:'30px',gap:'6px',padding:'0 8px',borderBottom:'1px solid #8882',color:'inherit'})
    const title=host.ownerDocument.createElement('span')
    if(kind==='ai')titleAiTabs([tab])
    const paneTitle=()=>kind==='ai'?aiPaneTitle(tab):tab.title||tab.customTitle||''
    title.textContent=paneTitle()
    title.title=title.textContent
    Object.assign(title.style,{fontSize:'12px',opacity:'.75',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})
    const icon=(path:string)=>{
        const svg=host.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg')
        for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value)
        const line=host.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);svg.append(line)
        return svg
    }
    const labels=()=>kind==='ai'?{toggle:t('收起 AI 终端'),expand:t('展开 AI 终端'),close:t('关闭 AI 终端'),previous:t('上一个窗格'),next:t('下一个窗格')}
        :{toggle:t('收起文件'),expand:t('展开文件'),close:t('关闭文件'),previous:t('上一个窗格'),next:t('下一个窗格')}
    const toggle=host.ownerDocument.createElement('button')
    toggle.type='button';toggle.className='arw-ai-toggle-button'
    const style=host.ownerDocument.createElement('style')
    style.textContent='.arw-ai-header > button{opacity:.55;transition:opacity .12s,background .12s}.arw-ai-header > button:hover{opacity:1;background:#8882 !important}.arw-ai-header > button:focus-visible{opacity:1;outline:1px solid currentColor;outline-offset:1px}.arw-ai-header > button:disabled{opacity:.22;cursor:default}.arw-ai-header > button:disabled:hover{background:transparent !important}.arw-workspace-hidden,.arw-ai-collapsed,.arw-stacked-hidden{display:none !important}'
    const restore=host.ownerDocument.createElement('button')
    restore.type='button';restore.className='arw-ai-expand-button'
    let assigned:BaseTabComponent[]=[]
    const siblings=()=>controlsFor(tab,app,kind)
    const updateToggle=()=>{
        if(kind==='ai')titleAiTabs([...controls].filter(entry=>entry.app===app&&entry.kind==='ai').map(entry=>entry.tab))
        title.textContent=paneTitle()
        title.title=title.textContent
        const panes=siblings(),text=labels(),stacked=panes.length>0&&stackedGroup(panes)
        const split=app.getParentTab(tab)
        const selected=stacked?(split?selectedStackedPane(split,kind,panes):panes[0]):undefined
        host.classList.toggle('arw-workspace-hidden',workspaceHiddenPanes.has(tab))
        host.classList.toggle('arw-stacked-hidden',stacked&&tab!==selected)
        host.classList.toggle('arw-ai-collapsed',!stacked&&collapsedAiPanes.has(tab))
        toggle.classList.toggle('arw-stack-previous',stacked)
        restore.classList.toggle('arw-stack-next',stacked)
        toggle.removeAttribute('aria-expanded')
        header.style.gridTemplateColumns=stacked?'22px 22px minmax(0, 1fr) 22px':'22px minmax(0, 1fr) auto 22px'
        toggle.style.gridColumn='1'
        title.style.gridColumn=stacked?'3':'2'
        restore.style.gridColumn=stacked?'2':'3'
        button.style.gridColumn='4'
        for(const item of [toggle,restore,title,button])item.style.gridRow='1'
        if(stacked){
            const position=Math.max(0,panes.indexOf(tab))+1,count=`${position}/${panes.length}`
            toggle.replaceChildren(icon('m15 6-6 6 6 6'))
            restore.replaceChildren(icon('m9 6 6 6-6 6'))
            toggle.title=`${text.previous} (${count})`
            restore.title=`${text.next} (${count})`
            toggle.setAttribute('aria-label',toggle.title)
            restore.setAttribute('aria-label',restore.title)
            toggle.disabled=panes.length<2
            restore.disabled=panes.length<2
            Object.assign(restore.style,{display:'grid',width:'22px',gap:'0',padding:'0'})
            assigned=[]
            return
        }
        const visible=panes.filter(item=>!collapsedAiPanes.has(item)),collapsed=collapsedAiPanes.has(tab)
        toggle.replaceChildren(icon('m6 9 6 6 6-6'))
        toggle.title=text.toggle;toggle.setAttribute('aria-label',toggle.title)
        toggle.setAttribute('aria-expanded',String(!collapsed))
        toggle.disabled=visible.length<2
        assigned=panes.filter(item=>{
            if(!collapsedAiPanes.has(item))return false
            const index=panes.indexOf(item)
            const neighbor=panes.slice(index+1).find(value=>!collapsedAiPanes.has(value))
                ??panes.slice(0,index).reverse().find(value=>!collapsedAiPanes.has(value))
            return neighbor===tab
        })
        restore.replaceChildren(icon('m9 6 6 6-6 6'),host.ownerDocument.createTextNode(String(assigned.length)))
        restore.style.display=assigned.length?'flex':'none'
        Object.assign(restore.style,{width:'auto',gap:'3px',padding:'0 4px'})
        restore.disabled=false
        restore.title=text.expand+` (${assigned.length})`
        restore.setAttribute('aria-label',restore.title)
    }
    const updateAll=()=>{
        for(const entry of controls){
            if(entry.app!==app)continue
            const split=app.getParentTab(entry.tab)
            if(!split)continue
            const panes=orderedSiblings(split,entry.kind,split.getAllTabs().filter(item=>workspacePaneKind(item)===entry.kind))
            if(panes.length&&panes.every(item=>collapsedAiPanes.has(item))){
                collapsedAiPanes.delete(panes[0])
                tileWorkspacePanes(app,split,true)
            }
        }
        for(const entry of controls)if(entry.app===app)entry.update()
    }
    const reflow=()=>{
        const split=app.getParentTab(tab)
        if(split)tileWorkspacePanes(app,split,true)
        updateAll()
    }
    const button=host.ownerDocument.createElement('button')
    button.className='arw-ai-close-button';button.type='button';button.append(icon('m6 6 12 12M18 6 6 18'))
    const text=labels()
    button.title=text.close;button.setAttribute('aria-label',button.title)
    for(const control of [toggle,restore,button])Object.assign(control.style,{display:'grid',placeItems:'center',width:'22px',height:'22px',padding:'0',border:'0',borderRadius:'3px',background:'transparent',color:'inherit',cursor:'pointer'})
    Object.assign(restore.style,{width:'auto',gap:'3px',padding:'0 4px'})
    const pinned=(value:unknown)=>Boolean((value as {pinned?:boolean}|null)?.pinned)
    let disposed=false,busy=false
    const stop=(event:Event)=>event.stopPropagation()
    const close=async(event:Event)=>{
        event.preventDefault();event.stopPropagation()
        if(disposed||busy||((tab as typeof tab&{effectivelyPinned?:boolean}).effectivelyPinned??(pinned(tab)||pinned(app.getParentTab(tab)))))return
        busy=true;button.disabled=true
        try{
            if(!await tab.canClose()||disposed)return
            if(app.tabs.includes(tab))await app.closeTab(tab,false)
            else if(app.getParentTab(tab)?.getAllTabs().includes(tab))tab.destroy()
        }catch(error){onError(error)}
        finally{busy=false;if(!disposed)button.disabled=false}
    }
    button.addEventListener('mousedown',stop);button.addEventListener('click',close)
    const cycle=(delta:number):boolean=>{
        const split=app.getParentTab(tab),panes=siblings()
        if(!split||panes.length<2||!stackedGroup(panes))return false
        const index=panes.indexOf(tab)
        if(index<0)return false
        const next=panes[(index+delta+panes.length)%panes.length]
        selectStackedPane(split,kind,next,panes)
        updateAll()
        split.focus(next)
        tileWorkspacePanes(app,split,true)
        return true
    }
    const collapse=(event:Event)=>{
        event.preventDefault();event.stopPropagation()
        if(cycle(-1))return
        if(siblings().filter(item=>!collapsedAiPanes.has(item)).length<2)return
        collapsedAiPanes.add(tab);reflow()
    }
    const expand=(event:Event)=>{
        event.preventDefault();event.stopPropagation()
        if(cycle(1))return
        const next=assigned[assigned.length-1]
        if(next){collapsedAiPanes.delete(next);reflow()}
    }
    restore.addEventListener('mousedown',stop);restore.addEventListener('click',expand)
    toggle.addEventListener('mousedown',stop);toggle.addEventListener('click',collapse)
    const updateLanguage=()=>{
        if(kind==='ai')titleAiTabs([...controls].filter(entry=>entry.app===app&&entry.kind==='ai').map(entry=>entry.tab))
        title.textContent=paneTitle();title.title=title.textContent
        const text=labels()
        button.title=text.close;button.setAttribute('aria-label',button.title)
        updateToggle()
    }
    const stopLocale=observeArwLocale(updateLanguage)
    const titleSubscription=tab.titleChange$?.subscribe(()=>{if(kind==='file')updateLanguage()})
    const entry:PaneControl={tab,app,kind,update:updateToggle}
    controls.add(entry)
    const subscription=app.tabsChanged$?.subscribe(updateAll)
    updateAll()
    header.append(toggle,title,restore,button)
    host.prepend(header,style)
    return ()=>{disposed=true;controls.delete(entry);titleSubscription?.unsubscribe();subscription?.unsubscribe();collapsedAiPanes.delete(tab);stackedHiddenPanes.delete(tab);updateAll();restore.removeEventListener('mousedown',stop);restore.removeEventListener('click',expand);stopLocale();button.removeEventListener('mousedown',stop);button.removeEventListener('click',close);toggle.removeEventListener('mousedown',stop);toggle.removeEventListener('click',collapse);host.style.display='none';host.classList.remove('arw-workspace-hidden','arw-ai-collapsed','arw-stacked-hidden');header.remove();style.remove()}
}
