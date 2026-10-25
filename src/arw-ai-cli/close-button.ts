import { collapsedAiPanes, orderedAiPanes } from './collapsed-panes'
import { tileAiTerminals } from './tiling'
import { t, observeArwLocale } from '../shared/i18n'
import type { AppService } from 'tabby-core'
import type { BaseTerminalTabComponent } from 'tabby-terminal'
import { aiPaneTitle, titleAiTabs } from '../shared/workspace-name'

interface PaneControl {tab: BaseTerminalTabComponent<any>; app: AppService; update: () => void}
const controls = new Set<PaneControl>()

/** Workspace header for this AI pane, respecting Tabby's process and pinned-tab guards. */
export function addAiCloseButton(tab:BaseTerminalTabComponent<any>,app:AppService,onError:(error:unknown)=>void):(()=>void)|undefined {
    if(!tab.profile?.options?.env?.ARW_WORKSPACE_ROOT)return
    const host=tab.element?.nativeElement as HTMLElement|undefined
    if(!host?.ownerDocument)return
    const header=host.ownerDocument.createElement('div')
    header.className='arw-ai-header'
    Object.assign(header.style,{display:'grid',gridTemplateColumns:'24px minmax(0, 1fr) auto 24px',alignItems:'center',flex:'0 0 30px',minHeight:'30px',gap:'6px',padding:'0 8px',borderBottom:'1px solid #8882',color:'inherit'})
    const title=host.ownerDocument.createElement('span')
    titleAiTabs([tab])
    title.textContent=aiPaneTitle(tab)
    title.title=title.textContent
    Object.assign(title.style,{fontSize:'12px',opacity:'.75',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})
    const icon=(path:string)=>{
        const svg=host.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg')
        for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value)
        const line=host.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);svg.append(line)
        return svg
    }
    const toggle=host.ownerDocument.createElement('button')
    toggle.type='button';toggle.className='arw-ai-toggle-button'
    const style=host.ownerDocument.createElement('style')
    style.textContent='.arw-ai-header > button{opacity:.55;transition:opacity .12s,background .12s}.arw-ai-header > button:hover{opacity:1;background:#8882 !important}.arw-ai-header > button:focus-visible{opacity:1;outline:1px solid currentColor;outline-offset:1px}.arw-ai-collapsed { display: none !important; }'
    const restore=host.ownerDocument.createElement('button')
    restore.type='button';restore.className='arw-ai-expand-button'
    let assigned:BaseTerminalTabComponent<any>[]=[]
    const siblings=()=>{
        const split=app.getParentTab(tab)
        const panes=(split?.getAllTabs()??[tab]).filter(item=>Boolean((item as BaseTerminalTabComponent<any>).profile?.options?.env?.ARW_WORKSPACE_ROOT))
        return split?orderedAiPanes(split,panes):panes
    }
    const updateToggle=()=>{
        titleAiTabs([...controls].filter(entry=>entry.app===app).map(entry=>entry.tab))
        title.textContent=aiPaneTitle(tab)
        title.title=title.textContent
        const panes=siblings(),visible=panes.filter(item=>!collapsedAiPanes.has(item))
        const collapsed=collapsedAiPanes.has(tab)
        host.classList.toggle('arw-ai-collapsed',collapsed)
        toggle.replaceChildren(icon('m6 9 6 6 6-6'))
        toggle.title=t('收起 AI 终端');toggle.setAttribute('aria-label',toggle.title)
        toggle.setAttribute('aria-expanded',String(!collapsed))
        toggle.disabled=visible.length<2
        assigned=panes.filter(item=>{
            if(!collapsedAiPanes.has(item))return false
            const index=panes.indexOf(item)
            const neighbor=panes.slice(index+1).find(value=>!collapsedAiPanes.has(value))
                ??panes.slice(0,index).reverse().find(value=>!collapsedAiPanes.has(value))
            return neighbor===tab
        }) as BaseTerminalTabComponent<any>[]
        restore.replaceChildren(icon('m9 6 6 6-6 6'),host.ownerDocument.createTextNode(String(assigned.length)))
        restore.style.display=assigned.length?'flex':'none'
        restore.title=t('展开 AI 终端')+` (${assigned.length})`
        restore.setAttribute('aria-label',restore.title)
    }
    const updateAll=()=>{
        for(const entry of controls){
            if(entry.app!==app)continue
            const split=app.getParentTab(entry.tab)
            const panes=split?.getAllTabs().filter(item=>Boolean((item as BaseTerminalTabComponent<any>).profile?.options?.env?.ARW_WORKSPACE_ROOT))??[]
            if(panes.length&&panes.every(item=>collapsedAiPanes.has(item))){
                collapsedAiPanes.delete(panes[0])
                tileAiTerminals(app,split!,true)
            }
            entry.update()
        }
    }
    const reflow=()=>{
        const split=app.getParentTab(tab)
        if(split)tileAiTerminals(app,split,true)
        updateAll()
    }
    const button=host.ownerDocument.createElement('button')
    button.className='arw-ai-close-button';button.type='button';button.append(icon('m6 6 12 12M18 6 6 18'))
    button.title=t('关闭 AI 终端');button.setAttribute('aria-label',t('关闭 AI 终端'))
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
    const collapse=(event:Event)=>{
        event.preventDefault();event.stopPropagation()
        if(siblings().filter(item=>!collapsedAiPanes.has(item)).length<2)return
        collapsedAiPanes.add(tab);reflow()
    }
    const expand=(event:Event)=>{
        event.preventDefault();event.stopPropagation()
        const next=assigned[assigned.length-1]
        if(next){collapsedAiPanes.delete(next);reflow()}
    }
    restore.addEventListener('mousedown',stop);restore.addEventListener('click',expand)
    toggle.addEventListener('mousedown',stop);toggle.addEventListener('click',collapse)
    const updateLanguage=()=>{
        titleAiTabs([...controls].filter(entry=>entry.app===app).map(entry=>entry.tab))
        title.textContent=aiPaneTitle(tab)
        title.title=title.textContent
        button.title=t('关闭 AI 终端');button.setAttribute('aria-label',button.title)
        updateToggle()
    }
    const stopLocale=observeArwLocale(updateLanguage)
    const entry:PaneControl={tab,app,update:updateToggle}
    controls.add(entry)
    const subscription=app.tabsChanged$?.subscribe(updateAll)
    updateAll()
    header.append(toggle,title,restore,button)
    host.prepend(header,style)
    return ()=>{disposed=true;controls.delete(entry);subscription?.unsubscribe();collapsedAiPanes.delete(tab);updateAll();restore.removeEventListener('mousedown',stop);restore.removeEventListener('click',expand);stopLocale();button.removeEventListener('mousedown',stop);button.removeEventListener('click',close);toggle.removeEventListener('mousedown',stop);toggle.removeEventListener('click',collapse);host.classList.remove('arw-ai-collapsed');header.remove();style.remove()}
}
