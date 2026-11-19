import { isAiPane, isFilePane, paneMatchesWorkspace, type WorkspacePaneIdentity } from './pane-kind'

const selectedWorkspaces=new WeakMap<object,WorkspacePaneIdentity>()
const selectedTerminals=new WeakMap<object,object>()
export const workspaceHiddenPanes=new WeakSet<object>()

export function workspaceTerminalId(pane:unknown):string|undefined {
    const options=(pane as {profile?:{options?:{arwProjectWorkspaceId?:string;__getValue?:(key:string)=>unknown}}})?.profile?.options
    const id=options?.arwProjectWorkspaceId??options?.__getValue?.('arwProjectWorkspaceId')
    return typeof id==='string'&&id?id:undefined
}

export function selectWorkspaceTerminal(split:object,terminal:object):void {
    selectedTerminals.set(split,terminal)
}

export function selectedWorkspaceTerminal(split:object):object|undefined {
    return selectedTerminals.get(split)
}

export function selectPaneWorkspace(split:object,workspace:WorkspacePaneIdentity):void {
    selectedWorkspaces.set(split,workspace)
}

/** Keep inactive panes in the split for recovery and running terminal sessions. */
export function updateWorkspaceVisibility(split:object,panes:object[]):void {
    const workspace=selectedWorkspaces.get(split)
    const managed=panes.filter(workspaceTerminalId)
    const selected=selectedTerminals.get(split)
    const anchor=panes.find(pane=>!workspaceTerminalId(pane)&&!isAiPane(pane)&&!isFilePane(pane))
    const terminal=selected&&panes.includes(selected)?selected:anchor??managed[0]
    for(const pane of panes){
        const hiddenTerminal=managed.length>0&&pane!==terminal&&(workspaceTerminalId(pane)||pane===anchor)
        if(hiddenTerminal||(workspace&&(isAiPane(pane)||isFilePane(pane))&&!paneMatchesWorkspace(pane,workspace)))workspaceHiddenPanes.add(pane)
        else workspaceHiddenPanes.delete(pane)
    }
}
