import { transfer } from '../arw-cli/transfers'
import { sftpCopy } from './sftp-copy'
import { RemotePathGuard } from '../security/remote-path'
import type { SSHSession } from './ssh-compat'
import type { Workspace } from '../arw-tree/workspace'

/** Reuse the CLI's streaming transfer and no-overwrite semantics for desktop drops. */
export async function uploadLocalPaths (
    session: SSHSession, workspace: Workspace, paths: string[], destination: string, signal: AbortSignal,
    progress: (path: string) => void = () => undefined,
): Promise<void> {
    signal.throwIfAborted()
    if (!session.open) throw new Error('SSH disconnected')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, {once: true})
    session.ref()
    const closed = session.willDestroy$.subscribe(abort)
    try {
        const guard = new RemotePathGuard(workspace.root, (command, signal) => workspace.run(command, signal))
        const target = await guard.resolve(destination, false, controller.signal)
        const copy = sftpCopy(() => session.openSFTP(), guard)
        const invoke = async (_name: string, args: Record<string, unknown>) => {
            // Let cancellation requests clean up even after the operation was aborted.
            return await copy(args, args.action === 'cancel' ? new AbortController().signal : controller.signal) as Record<string, unknown>
        }
        const info = await invoke('remote_upload', {action: 'stat', path: target})
        if (!info.directory) throw new Error('Upload destination is not a directory')
        for (const path of paths) {
            controller.signal.throwIfAborted()
            progress(path)
            await transfer('upload',{source:path,target,recursive:true},invoke)
        }
    } finally {
        closed.unsubscribe()
        signal.removeEventListener('abort', abort)
        session.unref()
    }
}

/** Electron 32+ uses webUtils; older hosts expose File.path. */
export function droppedLocalPaths (files: FileList, resolvePath: (file: File) => string): string[] {
    return [...new Set(Array.from(files, file => {
        const path = resolvePath(file)
        if (!path) throw new Error('Cannot resolve the dropped local file path')
        return path
    }))]
}
