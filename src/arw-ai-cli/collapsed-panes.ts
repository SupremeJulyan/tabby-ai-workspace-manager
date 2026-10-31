/** Pane state stays attached to the live tab while layout containers change. */
export const collapsedAiPanes = new WeakSet<object>()

export type PaneOrderGroup = 'ai' | 'file'
interface PaneOrder { positions:WeakMap<object,number>; next:number }
const orders = new WeakMap<object, Partial<Record<PaneOrderGroup, PaneOrder>>>()

/** Keep each group's adjacency stable when hidden panes move to zero-sized layout slots. */
export function orderedPanes<T extends object> (split: object, group: PaneOrderGroup, panes: T[]): T[] {
    const groups=orders.get(split)??{},order=groups[group]??{positions:new WeakMap<object,number>(),next:0}
    // Remember hidden panes without keeping closed panes alive for the lifetime of the split.
    for(const pane of panes)if(!order.positions.has(pane))order.positions.set(pane,order.next++)
    groups[group]=order
    orders.set(split,groups)
    return [...panes].sort((left,right)=>order.positions.get(left)!-order.positions.get(right)!)
}

export function orderedAiPanes<T extends object> (split: object, panes: T[]): T[] {
    return orderedPanes(split,'ai',panes)
}

export function orderedFilePanes<T extends object> (split: object, panes: T[]): T[] {
    return orderedPanes(split,'file',panes)
}
