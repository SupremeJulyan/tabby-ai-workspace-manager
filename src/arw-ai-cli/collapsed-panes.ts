/** Pane state stays attached to the live terminal while layout containers change. */
export const collapsedAiPanes = new WeakSet<object>()

const orders = new WeakMap<object, object[]>()
/** Keep adjacency stable when hidden panes move to zero-sized layout slots. */
export function orderedAiPanes<T extends object> (split: object, panes: T[]): T[] {
    const previous=orders.get(split)??[]
    const order=[...previous.filter(pane=>panes.includes(pane as T)),...panes.filter(pane=>!previous.includes(pane))]
    orders.set(split,order)
    return order as T[]
}
