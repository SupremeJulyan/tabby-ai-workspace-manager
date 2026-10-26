import type { WorkspacePaneKind } from './pane-kind'

export type PaneLayout = 'tiled' | 'tabs' | 'stacked'
type LayoutPane = {arwPaneLayout?:unknown;profile?:{options?:{env?:Record<string,string>}}}
const selections = new WeakMap<object,Partial<Record<WorkspacePaneKind,{pane:object;index:number}>>>()
export const stackedHiddenPanes = new WeakSet<object>()

export function paneLayout(value:unknown):PaneLayout {
    return value==='tabs'||value==='stacked'?value:'tiled'
}

export function stackedGroup(panes:object[]):boolean {
    const last=panes[panes.length-1] as LayoutPane|undefined
    return paneLayout(last?.arwPaneLayout??last?.profile?.options?.env?.ARW_PANE_LAYOUT)==='stacked'
}

export function selectStackedPane(split:object,kind:WorkspacePaneKind,pane:object,panes:object[]):void {
    const groups=selections.get(split)??{}
    groups[kind]={pane,index:Math.max(0,panes.indexOf(pane))}
    selections.set(split,groups)
}

export function selectedStackedPane<T extends object>(split:object,kind:WorkspacePaneKind,panes:T[]):T|undefined {
    if(!panes.length)return
    const selected=selections.get(split)?.[kind]
    return selected&&panes.includes(selected.pane as T)?selected.pane as T:panes[Math.min(selected?.index??0,panes.length-1)]
}
