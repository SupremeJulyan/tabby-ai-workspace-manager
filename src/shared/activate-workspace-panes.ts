import { selectPaneWorkspace, updateWorkspaceVisibility, workspaceHiddenPanes } from './workspace-pane-visibility'
import type { AppService, BaseTabComponent, SplitTabComponent } from 'tabby-core'
import { isAiPane, isFilePane, paneMatchesWorkspace, type WorkspacePaneIdentity } from './pane-kind'
import { selectedStackedPane, selectStackedPane, stackedHiddenPanes } from './pane-layout'
import { collapsedAiPanes, orderedAiPanes, orderedFilePanes } from '../arw-ai-cli/collapsed-panes'
import { tileWorkspacePanes } from '../arw-ai-cli/tiling'

/** Reveal matching live panes without destroying sessions or selecting several tabs in succession. */
export function activateWorkspacePanes(app:AppService,workspace:WorkspacePaneIdentity):boolean {
    const matches:Array<{top:BaseTabComponent;pane:BaseTabComponent}>=[]
    for(const top of app.tabs??[]){
        const split=top as SplitTabComponent
        const panes=typeof split.getAllTabs==='function'?split.getAllTabs():[top]
        if(top!==app.activeTab)continue
        selectPaneWorkspace(split,workspace)
        updateWorkspaceVisibility(split,panes)
        const matching=panes.filter(pane=>(isFilePane(pane)||isAiPane(pane))&&paneMatchesWorkspace(pane,workspace))
        for(const pane of matching){collapsedAiPanes.delete(pane);matches.push({top,pane})}
        if(typeof split.getAllTabs==='function'){
            for(const kind of ['file','ai'] as const){
                const predicate=kind==='file'?isFilePane:isAiPane
                const group=kind==='file'?orderedFilePanes(split,panes.filter(pane=>predicate(pane)&&!workspaceHiddenPanes.has(pane))):orderedAiPanes(split,panes.filter(pane=>predicate(pane)&&!workspaceHiddenPanes.has(pane)))
                const selected=selectedStackedPane(split,kind,group)
                if(selected)selectStackedPane(split,kind,selected,group)
            }
            tileWorkspacePanes(app,split,true)
        }
    }
    const selected=matches.find(entry=>entry.top===app.activeTab&&!stackedHiddenPanes.has(entry.pane))??matches.find(entry=>!stackedHiddenPanes.has(entry.pane))
    if(!selected)return false
    app.selectTab(selected.top)
    const split=selected.top as SplitTabComponent
    if(typeof split.focus==='function')split.focus(selected.pane)
    return true
}
