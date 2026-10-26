/** Pane state stays attached to the live tab while layout containers change. */
export const collapsedAiPanes = new WeakSet<object>()

export type PaneOrderGroup = 'ai' | 'file'
const orders = new WeakMap<object, Partial<Record<PaneOrderGroup, object[]>>>()

/** Keep each group's adjacency stable when hidden panes move to zero-sized layout slots. */
export function orderedPanes<T extends object> (split: object, group: PaneOrderGroup, panes: T[]): T[] {
    const groups=orders.get(split)??{},previous=groups[group]??[]
    const order=[...previous.filter(pane=>panes.includes(pane as T)),...panes.filter(pane=>!previous.includes(pane))]
    groups[group]=order
    orders.set(split,groups)
    return order as T[]
}

export function orderedAiPanes<T extends object> (split: object, panes: T[]): T[] {
    return orderedPanes(split,'ai',panes)
}

export function orderedFilePanes<T extends object> (split: object, panes: T[]): T[] {
    return orderedPanes(split,'file',panes)
}
