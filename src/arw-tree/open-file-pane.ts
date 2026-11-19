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

const pendingOpens=new WeakMap<AppService,Promise<unknown>>()

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
    if(!isFilePane(pane)||!(pane instanceof type)||!inputs?.workspace||typeof inputs.filePath!=='string')return false
    const diff=inputs.diffPatch!==undefined
    if((pane.diffPatch!==undefined)!==diff)return false
    if(diff){
        if(Boolean(pane.diffStaged)!==Boolean(inputs.diffStaged)||pane.diffLabel!==inputs.diffLabel||pane.diffDescription!==inputs.diffDescription)return false
    }else if(pane.readonly||inputs.readonly)return false
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
export async function openFilePane<T extends BaseTabComponent> (app:AppService,params:NewTabParameters<T>,source?:BaseTabComponent|null,layout='stacked',tabs?:Pick<TabsService,'create'>):Promise<T|undefined> {
    const task=(pendingOpens.get(app)??Promise.resolve()).catch(()=>{}).then(()=>openFile(app,params,source,layout,tabs))
    pendingOpens.set(app,task)
    try{return await task}
    finally{if(pendingOpens.get(app)===task)pendingOpens.delete(app)}
}

async function openFile<T extends BaseTabComponent>(app:AppService,params:NewTabParameters<T>,source:BaseTabComponent|null|undefined,layout:string,tabs?:Pick<TabsService,'create'>):Promise<T|undefined>{
    const anchor=topLevelFor(app,source??app.activeTab)
    rememberRemoteFiles(app)
    if(!anchor||app.tabs.length===0){
        if(!await enforceRemoteFileLimit(app,1,true))return
        return app.openNewTab(params)
    }
    const split=('getAllTabs' in anchor?anchor:app.getParentTab(anchor)??app.wrapAndAddTab(anchor)) as SplitTabComponent
    if(anchor!==split&&app.tabs.includes(anchor))app.removeTab(anchor)
    const existing=split.getAllTabs().find(pane=>sameFile(pane,params.inputs,params.type)) as T|undefined
    if(existing){
        if(params.inputs?.diffPatch!==undefined){
            const diff=existing as T & {updateDiff(patch:string):void}
            diff.updateDiff(params.inputs.diffPatch)
        }
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
    if(!await enforceRemoteFileLimit(app,1,true))return
    if(!app.tabs.includes(split))return app.openNewTab(params)
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
    return file
}
