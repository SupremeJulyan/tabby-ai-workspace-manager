import { t } from '../shared/i18n'
import * as TabbySSH from 'tabby-ssh'
import type { FileDownload, FileTransfer, NotificationsService, PlatformService } from 'tabby-core'
import type { SFTPFile, SFTPSession } from 'tabby-ssh/typings/session/sftp'
import type { Workspace } from '../arw-tree/workspace'
import type { SSHSession } from './ssh-compat'
import { RemotePathGuard } from '../security/remote-path'
import { posix } from 'node:path'

interface NativePanel {
    sftp: SFTPSession
    downloadFolder?(item: SFTPFile): Promise<void>
}
type DownloadPlatform = PlatformService & {startDownloadDirectory?(name:string, size:number):Promise<FileTransfer|null>}
const cancelled = (error: unknown) => /cancelled|canceled|已取消/i.test(String(error))

/** Uses the host's save dialogs, transfer progress and native SFTP folder downloader. */
export async function downloadSftpItem (
    session: SSHSession, workspace: Workspace, input: string,
    platform: PlatformService, notifications: NotificationsService,
): Promise<void> {
    if (!session.open) { notifications.error(t('下载失败'), t('SSH 已断开')); return }
    const controller = new AbortController(), transfers = new Set<FileTransfer>()
    let reported = false
    session.ref()
    const closed = session.willDestroy$.subscribe(() => {
        controller.abort()
        for (const transfer of transfers) transfer.cancel()
    })
    try {
        const guard = new RemotePathGuard(workspace.root, (command, signal) => workspace.run(command, signal))
        const path = await guard.resolve(input, false, controller.signal)
        const transferGuard = new RemotePathGuard(await guard.resolve('.', false, controller.signal), (command, signal) => workspace.run(command, signal))
        const sftp = await session.openSFTP(), item = await sftp.stat(path)
        controller.signal.throwIfAborted()
        const track = async <T extends FileTransfer>(transfer: T|null): Promise<T|null> => {
            if (transfer) {
                transfers.add(transfer)
                if (controller.signal.aborted) { transfer.cancel(); controller.signal.throwIfAborted() }
            }
            return transfer
        }
        // Bind host methods to their original objects: platform implementations contain native state.
        const host = new Proxy(platform as DownloadPlatform, {get(target, key) {
            if (key === 'startDownloadDirectory' && target.startDownloadDirectory) return async (name:string, size:number) => track(await target.startDownloadDirectory!(name, size))
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
        }})
        const guarded = Object.create(sftp) as SFTPSession
        guarded.readdir = async directory => {
            const target = await transferGuard.resolve(directory, false, controller.signal)
            const entries = await sftp.readdir(target)
            controller.signal.throwIfAborted()
            return entries.filter(entry => !['.', '..'].includes(entry.name) && !entry.isSymlink).map(entry => {
                if (!entry.name || /[\\/\x00:]/.test(entry.name)) throw new Error(t('远端文件名不能安全保存到本地'))
                return {...entry, fullPath: posix.join(target, entry.name)}
            })
        }
        guarded.download = async (file, transfer) => {
            const target = await transferGuard.resolve(file, false, controller.signal)
            const sink = new Proxy(transfer, {get(target, key) {
                if (key === 'write') return async (chunk:Uint8Array) => {
                    controller.signal.throwIfAborted()
                    if (transfer.isCancelled() || [...transfers].some(transfer=>transfer.isCancelled())) throw new Error('Download cancelled')
                    await transfer.write(chunk)
                }
                const value = Reflect.get(target, key)
                return typeof value === 'function' ? value.bind(target) : value
            }})
            await sftp.download(target, sink)
            controller.signal.throwIfAborted()
        }
        if (!item.isDirectory) {
            const transfer = await track(await platform.startDownload(posix.basename(path), item.mode, item.size))
            if (transfer) await guarded.download(path, transfer as FileDownload)
            return
        }
        // The published .d.ts predates directory downloads, but supported Tabby hosts export it.
        const Panel = TabbySSH.SFTPPanelComponent as unknown as new (...args:any[]) => NativePanel
        if (typeof Panel !== 'function' || !Panel.prototype.downloadFolder || !host.startDownloadDirectory) throw new Error(t('当前 Tabby 版本不支持目录下载，请升级 Tabby'))
        const notices = new Proxy(notifications, {get(target, key) {
            if (key === 'error') return (...args: Parameters<NotificationsService['error']>) => {
                if (!controller.signal.aborted && !cancelled(args.join(' '))) { reported = true; target.error(...args) }
            }
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
        }})
        const panel = new Panel(undefined, notices, host, [])
        panel.sftp = guarded
        await panel.downloadFolder!({...item, name:posix.basename(path), fullPath:path})
    } catch (error) {
        const disconnected = controller.signal.aborted
        controller.abort()
        for (const transfer of transfers) transfer.cancel()
        if (!reported && !disconnected && !cancelled(error)) notifications.error(t('下载失败'), error instanceof Error ? error.message : String(error))
    } finally {
        closed.unsubscribe()
        session.unref()
    }
}
