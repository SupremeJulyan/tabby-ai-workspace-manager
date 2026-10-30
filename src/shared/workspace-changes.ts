import type { Workspace } from '../arw-tree/workspace'

type Listener = (workspace: Workspace) => void
const listeners = new Set<Listener>()

export function subscribeWorkspaceChanges(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function notifyWorkspaceChange(workspace: Workspace): void {
    for (const listener of listeners) listener(workspace)
}
