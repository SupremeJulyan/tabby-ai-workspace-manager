import { isAiPane, isFilePane, paneMatchesWorkspace, type WorkspacePaneIdentity } from './pane-kind'

const selectedWorkspaces=new WeakMap<object,WorkspacePaneIdentity>()
export const workspaceHiddenPanes=new WeakSet<object>()

export function selectPaneWorkspace(split:object,workspace:WorkspacePaneIdentity):void {
    selectedWorkspaces.set(split,workspace)
}

/** Keep inactive panes in the split for recovery and running terminal sessions. */
export function updateWorkspaceVisibility(split:object,panes:object[]):void {
    const workspace=selectedWorkspaces.get(split)
    for(const pane of panes){
        if(workspace&&(isAiPane(pane)||isFilePane(pane))&&!paneMatchesWorkspace(pane,workspace))workspaceHiddenPanes.add(pane)
        else workspaceHiddenPanes.delete(pane)
    }
}
