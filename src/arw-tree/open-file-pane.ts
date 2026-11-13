import { rememberRemoteFiles, enforceRemoteFileLimit } from './remote-file-limit'
import { selectPaneWorkspace } from '../shared/workspace-pane-visibility'
import { paneLayout, selectStackedPane } from '../shared/pane-layout'
import { orderedFilePanes } from '../arw-ai-cli/collapsed-panes'
import { isFilePane, type WorkspacePaneIdentity } from '../shared/pane-kind'
import { isAbsolute, posix, resolve } from 'node:path'
import type { Workspace } from './workspace'
import { collapsedAiPanes } from '../arw-ai-cli/collapsed-panes'
import type { AppService, BaseTabComponent, SplitTabComponent, TabsService } from 'tabby-core'
import type { NewTabParameters } from 'tabby-core/typings/services/tabs.service'
import { tileWorkspacePanes } from '../arw-ai-cli/tiling'

function topLevelFor (app:AppService,tab:BaseTabComponent|null|undefined):BaseTabComponent|undefined {
    if(!tab||!app.tabs?.length)return
    const visited=new Set<BaseTabComponent>()
    while(!app.tabs.includes(tab)&&!visited.has(tab)){
        visited.add(tab)
        const parent=app.getParentTab(tab)
        if(!parent)break
        tab=parent
    }
    return app.tabs.includes(tab)?tab:undefined
}

const highlights = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
function highlightPane(tab:BaseTabComponent):void {
    const host=(tab as any).element?.nativeElement ?? (tab.viewContainerEmbeddedRef??tab.hostView as {rootNodes?:HTMLElement[]})?.rootNodes?.find((node:HTMLElement)=>node.nodeType===1)
    if(!host?.style)return
    const previous=highlights.get(host)
    if(previous)clearTimeout(previous)
    host.style.setProperty('outline','3px solid #ef4444','important')
    host.style.setProperty('outline-offset','-3px','important')
    highlights.set(host,setTimeout(()=>{host.style.removeProperty('outline');host.style.removeProperty('outline-offset');highlights.delete(host)},1500))
}

function sameFile(pane:any,inputs:any,type:any):boolean {
    if(!isFilePane(pane)||!(pane instanceof type)||!inputs?.workspace||typeof inputs.filePath!=='string'||pane.isDiff||pane.readonly||inputs.diffPatch!==undefined||inputs.readonly)return false
    const left=pane.workspace as Workspace,right=inputs.workspace as Workspace
    if(!left||typeof pane.filePath!=='string')return false
    if(left.kind!==right.kind)return false
    const root=(workspace:Workspace):string=>{
        let current=workspace,path=workspace.root
        const seen=new Set<Workspace>()
        while(current.sourceWorkspace&&!seen.has(current)){
            seen.add(current)
            const parent=current.sourceWorkspace
            if(!(workspace.kind==='remote'?posix.isAbsolute(path):isAbsolute(path)))path=workspace.kind==='remote'?posix.resolve(parent.root,path):resolve(parent.root,path)
            current=parent
        }
        return workspace.kind==='remote'?posix.resolve(path):resolve(path)
    }
    if(root(left)!==root(right))return false
    if(left.kind==='remote'&&(left.identityKey&&right.identityKey?left.identityKey!==right.identityKey:left.host!==right.host))return false
    const absolutePath=(workspace:Workspace,path:string)=>workspace.kind==='remote'?posix.resolve(root(workspace),path):resolve(root(workspace),path)
    return absolutePath(left,pane.filePath)===absolutePath(right,inputs.filePath)
}

function selectFileWorkspace(split:SplitTabComponent,pane:BaseTabComponent):void {
    const file=pane as BaseTabComponent&{arwWorkspaceIdentity?:WorkspacePaneIdentity;workspace?:WorkspacePaneIdentity}
    const identity=file.arwWorkspaceIdentity??file.workspace
    if(identity)selectPaneWorkspace(split,identity)
}

/** Open a file inside the current split instead of creating another top-level tab. */
export async function openFilePane<T extends BaseTabComponent> (app:AppService,params:NewTabParameters<T>,source?:BaseTabComponent|null,layout='stacked',tabs?:Pick<TabsService,'create'>):Promise<T> {
    const anchor=topLevelFor(app,source??app.activeTab)
    rememberRemoteFiles(app)
    if(!anchor||app.tabs.length===0){const file=await app.openNewTab(params);await enforceRemoteFileLimit(app);return file}
    const split=('getAllTabs' in anchor?anchor:app.getParentTab(anchor)??app.wrapAndAddTab(anchor)) as SplitTabComponent
    if(anchor!==split&&app.tabs.includes(anchor))app.removeTab(anchor)
    const existing=split.getAllTabs().find(pane=>sameFile(pane,params.inputs,params.type)) as T|undefined
    if(existing){
        selectFileWorkspace(split,existing)
        collapsedAiPanes.delete(existing)
        app.selectTab(split)
        selectStackedPane(split,'file',existing,orderedFilePanes(split,split.getAllTabs().filter(isFilePane)))
        split.focus(existing)
        tileWorkspacePanes(app,split,true)
        highlightPane(existing)
        return existing
    }
    if(!tabs)throw new Error('File panes require Tabby TabsService')
    const file=tabs.create({...params,inputs:{...params.inputs,arwPaneLayout:paneLayout(layout)}})
    try{
        await split.add(file,null,'b')
    }catch(error){
        file.destroy()
        throw error
    }
    selectFileWorkspace(split,file)
    app.selectTab(split)
    selectStackedPane(split,'file',file,orderedFilePanes(split,split.getAllTabs().filter(isFilePane)))
    split.focus(file)
    tileWorkspacePanes(app,split,true)
    await enforceRemoteFileLimit(app)
    return file
}
