import type { WorkspacePaneKind } from './pane-kind'
import { workspaceHiddenPanes } from './workspace-pane-visibility'

export type PaneLayout = 'tiled' | 'stacked'
type LayoutPane = {arwPaneLayout?:unknown;profile?:{options?:{env?:Record<string,string>}}}
const selections = new WeakMap<object,Partial<Record<WorkspacePaneKind,{pane:object;index:number}>>>()
const paneSelections = new WeakMap<object,{pane:object;index:number}>()
export const stackedHiddenPanes = new WeakSet<object>()

export function paneLayout(value:unknown):PaneLayout {
    return value==='stacked'?'stacked':'tiled'
}

export function stackedGroup(panes:object[]):boolean {
    const last=panes[panes.length-1] as LayoutPane|undefined
    return paneLayout(last?.arwPaneLayout??last?.profile?.options?.env?.ARW_PANE_LAYOUT)==='stacked'
}

export function selectStackedPane(split:object,kind:WorkspacePaneKind,pane:object,panes:object[]):void {
    panes=panes.filter(member=>member===pane||!workspaceHiddenPanes.has(member))
    const groups=selections.get(split)??{}
    groups[kind]={pane,index:Math.max(0,panes.indexOf(pane))}
    for(const member of panes)paneSelections.set(member,groups[kind]!)
    selections.set(split,groups)
}

export function selectedStackedPane<T extends object>(split:object,kind:WorkspacePaneKind,panes:T[]):T|undefined {
    if(!panes.length)return
    const selected=paneSelections.get(panes[0])??selections.get(split)?.[kind]
    return selected&&panes.includes(selected.pane as T)?selected.pane as T:panes[Math.min(selected?.index??0,panes.length-1)]
}
