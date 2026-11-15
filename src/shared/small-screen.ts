import { isAiPane, isFilePane } from './pane-kind'

export type ScreenLayer = 'files' | 'terminal' | 'ai'
export const screenLayers: ScreenLayer[] = ['files', 'terminal', 'ai']
const readers = new WeakMap<object, () => boolean>()
const selections = new WeakMap<object, ScreenLayer>()

export function registerSmallScreen(app: object, read: () => boolean): () => void {
    readers.set(app, read)
    return () => { if (readers.get(app) === read) readers.delete(app) }
}
export function smallScreenEnabled(app: object): boolean { return readers.get(app)?.() === true }
export function paneScreenLayer(pane: unknown): ScreenLayer {
    return isFilePane(pane) ? 'files' : isAiPane(pane) ? 'ai' : 'terminal'
}
export function selectedScreenLayer(split: object): ScreenLayer { return selections.get(split) ?? 'files' }
export function selectScreenLayer(split: object, layer: ScreenLayer): void { selections.set(split, layer) }
