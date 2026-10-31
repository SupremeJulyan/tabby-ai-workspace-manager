import { cliWorkspaceFiles } from './workspace-files'
import { gitRelayOperation } from '../adapters/git-relay-operation'
import { activityScope } from './agent-activity'
import { isTerminalCommandMode, runTerminalCommand } from '../shared/terminal-command'
import { t } from '../shared/i18n'
import { registerActiveWorkspace, workspaceCatalogPath } from './workspace-catalog'
import { sftpCopy } from '../adapters/sftp-copy'
import { RemotePathGuard } from '../security/remote-path'
import { Injectable } from '@angular/core'
import { NotificationsService, PlatformService, AppService } from 'tabby-core'
import { Subject } from 'rxjs'
import { randomUUID } from 'crypto'
import { posix, join, dirname } from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { ForwardingServer } from './forwarding-server'
import { shellQuote } from '../shared/shell-quote'
import { ArwEditorComponent } from '../arw-tree/editor.component'
import { remoteWorkspace, remoteWorkspaceSession } from '../adapters/remote-workspace'
import type { SSHTabComponent, SSHSession } from '../adapters/ssh-compat'

interface ForwardingEntry {
    root: string
    server: ForwardingServer
    session: SSHSession
    configPath: string
    configDirectory: string
    unregister?: ()=>Promise<void>
    closed: { unsubscribe(): void }
}

@Injectable()
export class ForwardingService {
    readonly changed = new Subject<void>()
    private entries = new WeakMap<SSHTabComponent, ForwardingEntry>()
    private pending = new WeakMap<SSHTabComponent, object>()

    constructor (private notifications: NotificationsService, private platform: PlatformService, private app: AppService) { }

    state (tab: SSHTabComponent, root: string): ForwardingEntry|undefined {
        const entry = this.entries.get(tab)
        return entry?.root === root && entry.session === tab.sshSession ? entry : undefined
    }

    busy (tab: SSHTabComponent): boolean { return this.pending.has(tab) }

    async disable (tab: SSHTabComponent): Promise<void> {
        this.pending.delete(tab)
        const entry = this.entries.get(tab)
        if (!entry) return
        this.entries.delete(tab)
        entry.closed.unsubscribe()
        this.changed.next()
        try { await entry.server.stop() } finally {
            try { await entry.unregister?.() }
            finally {
                try { await rm(entry.configDirectory, { recursive: true, force: true }) }
                finally { entry.session.unref() }
            }
        }
    }

    copy (tab: SSHTabComponent, root: string): void {
        const entry = this.state(tab, root)
        if (!entry) return
        this.platform.setClipboard({text:'arw workspaces'})
        this.notifications.info(t('ARW：CLI 命令已复制，可供本地 Agent 使用'))
    }

    async toggle (tab: SSHTabComponent, directory: string, isCurrent?:()=>boolean): Promise<void> {
        const root = posix.normalize(directory)
        if (this.state(tab, root)) { await this.disable(tab); return }
        if (this.busy(tab)) return
        await this.disable(tab)
        const session = tab.sshSession
        if (!session?.open) { this.notifications.error(t('ARW：SSH 尚未连接')); return }
        const ticket = {}
        this.pending.set(tab, ticket)
        this.changed.next()
        session.ref()
        let server: ForwardingServer|undefined
        let retained = false
        let unregister: (()=>Promise<void>)|undefined
        let configDirectory: string|undefined
        try {
            if (!root.startsWith('/') || /[\x00-\x1f\x7f]/.test(root)) throw new Error(t('远程目录路径无效'))
            const sftp = await session.openSFTP()
            if (!(await sftp.stat(root)).isDirectory) throw new Error(t('请选择远程目录'))
            const workspace = remoteWorkspace(session, root)
            const cliFiles = cliWorkspaceFiles(workspace)
            const tabbyConfigPath = this.platform.getConfigPath?.()
            const workspaceId = randomUUID()
            server = new ForwardingServer({
                activityScope: activityScope(tab),
                workspace: { id: workspaceId, root, host: session.profile.options.host },
                terminalOnly:()=>isTerminalCommandMode(tab),
                git:gitRelayOperation(session,root,join(tabbyConfigPath?join(dirname(tabbyConfigPath),'omw'):dirname(workspaceCatalogPath()),'git-relay')),
                copy: sftpCopy(() => session.openSFTP(), new RemotePathGuard(root, (command, signal) => workspace.run(command, signal))),
                list: async (input, signal) => {
                    signal.throwIfAborted()
                    const files = await cliFiles.list(input)
                    signal.throwIfAborted()
                    return { entries: files, truncated: false }
                },
                read: async (input, signal) => {
                    signal.throwIfAborted()
                    return { path: input, ...await cliFiles.read(input) }
                },
                write: async (input, content, signal, expectedHash) => {
                    signal.throwIfAborted()
                    return { path: input, ...await cliFiles.write(input, content, expectedHash) }
                },
                run: (command, signal, options) => isTerminalCommandMode(tab)?runTerminalCommand(tab,root,command,signal,options?.maxBytes):workspace.run(command, signal, options),
                currentFile: () => {
                    const tab = this.app.activeTab;
                    const active = tab && 'getFocusedTab' in tab ? (tab as any).getFocusedTab() : tab;
                    if (!(active instanceof ArwEditorComponent) || active.workspace?.kind !== 'remote' || active.isDiff) return null;
                    const path = posix.resolve(active.workspace.sourceWorkspace?.root ?? active.workspace.root, active.workspace.sourceWorkspace ? active.workspace.root : '.', active.filePath);
                    return remoteWorkspaceSession(active.workspace) === session && (path === root || path.startsWith(root === '/' ? '/' : root + '/'))
                        ? {path, dirty: active.dirty} : null;
                },
                validateCommand: workspace.validateCommand?.bind(workspace),
            }, tabbyConfigPath ? join(dirname(tabbyConfigPath), 'omw', 'audit.jsonl') : undefined)
            await server.start()
            if (this.pending.get(tab) !== ticket || tab.sshSession !== session || !session.open
                || (isCurrent ? !isCurrent() : !tab.sftpPanelVisible || posix.normalize(tab.sftpPath) !== root)) {
                await server.stop()
                return
            }
            configDirectory = await mkdtemp(join(tmpdir(), 'tabby-ai-workspace-manager-cli-'))
            const configPath = join(configDirectory, 'connection.json')
            await writeFile(configPath, JSON.stringify(server.connection), { mode: 0o600, flag: 'wx' })
            if (this.pending.get(tab) !== ticket || tab.sshSession !== session || !session.open
                || (isCurrent ? !isCurrent() : !tab.sftpPanelVisible || posix.normalize(tab.sftpPath) !== root)) {
                await server.stop()
                return
            }
            unregister = await registerActiveWorkspace(tabbyConfigPath ? join(dirname(tabbyConfigPath),'omw','workspaces.json') : workspaceCatalogPath(), {
                workspaceId, workspaceRoot:root, host:session.profile.options.host,
                port:session.profile.options.port??22,user:session.authUsername??session.profile.options.user,
                name:root, status:'forwarded',configPath,
            })
            if (this.pending.get(tab)!==ticket || tab.sshSession!==session || !session.open || (isCurrent && !isCurrent())) return
            const closed = session.willDestroy$.subscribe(() => { void this.disable(tab) })
            this.entries.set(tab, { root, server, session, closed, configPath, configDirectory, unregister })
            retained = true
            this.notifications.info(t('ARW：已开启此目录的 Agent 转发'), root)
        } catch (error) {
            await server?.stop()
            this.notifications.error(t('ARW 转发开启失败'), error instanceof Error ? error.message : String(error))
        } finally {
            if (this.pending.get(tab) === ticket) this.pending.delete(tab)
            if (!retained) {
                try { await server?.stop() }
                finally {
                    try { await unregister?.() }
                    finally {
                        try { if (configDirectory) await rm(configDirectory, { recursive: true, force: true }) }
                        finally { session.unref() }
                    }
                }
            }
            this.changed.next()
        }
    }
}
