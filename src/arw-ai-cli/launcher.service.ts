import { activityScope } from '../arw-cli/agent-activity'
import { isTerminalCommandMode, runTerminalCommand } from '../shared/terminal-command'
import { randomUUID } from 'node:crypto'
import { t } from '../shared/i18n'
import { currentCliPath } from './cli-path'
import { registerActiveWorkspace } from '../arw-cli/workspace-catalog'
import { sftpCopy } from '../adapters/sftp-copy'
import { RemotePathGuard } from '../security/remote-path'
import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { NotificationsService, ProfilesService, ConfigService, PromptModalComponent, PlatformService,
    AppService } from 'tabby-core'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname, delimiter } from 'path'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { ForwardingServer } from '../arw-cli/forwarding-server'
import { ensureAgentCwdPlaceholder } from './agent-cwd'
import { WorkspaceRegistry, WorkspaceSelection } from '../services/workspace-registry.service'
import { ProjectStore } from '../arw-tree/project.store'
import { aiProxyEnvironment } from './proxy'
import { agentEnvironment } from './agent-env'
import { titleAiTabs, workspaceNames } from '../shared/workspace-name'

@Injectable()
export class AiLauncherService {
    private get auditFile (): string|undefined {
        const configPath = this.platform?.getConfigPath?.()
        return configPath ? join(dirname(configPath), 'omw', 'audit.jsonl') : undefined
    }
    constructor (private profiles: ProfilesService, private registry: WorkspaceRegistry,
        private notifications: NotificationsService, private config: ConfigService, private modal: NgbModal, private platform: PlatformService,
        private projects?: ProjectStore, private app?: AppService) { }
    /** Keep the AI tab in the same top-level split, immediately to the right of the workspace terminal. */
    private async placeBesideWorkspace (tab: BaseTerminalTabComponent<any>, selection: WorkspaceSelection): Promise<void> {
        const app = this.app
        const source = selection.sourceTerminal ?? selection.terminal
        if (!app || !source || source === tab) return
        const sourceSplit = app.getParentTab(source)
        if (sourceSplit) {
            if (!sourceSplit.getAllTabs().includes(tab)) await sourceSplit.add(tab, source, 'r')
            app.selectTab(sourceSplit)
            sourceSplit.focus(tab)
            return
        }
        // Tabs normally arrive already wrapped by AppService. Handle a legacy raw
        // terminal by attaching it to the AI tab's existing split instead.
        const ownSplit = app.getParentTab(tab)
        if (!ownSplit) return
        await ownSplit.add(source, tab, 'l')
        if (app.tabs.includes(source)) app.removeTab(source)
        app.selectTab(ownSplit)
        ownSplit.focus(tab)
    }
    /** Launch the command configured under Settings → ARW → AI CLI. */
    async launchConfigured (selection: WorkspaceSelection): Promise<void> {
        const configured = this.config.store.omw?.agent
        const command = configured?.command
        const configuredArgs = configured?.args ?? []
        if (typeof command !== 'string' || !command.trim() || !Array.isArray(configuredArgs) || configuredArgs.some(arg => typeof arg !== 'string')) {
            this.notifications.error(t('请先在 Tabby 设置 → ARW → AI CLI 中填写命令')); return
        }
        const args = configuredArgs.map((argument:string)=>argument.trim()).filter(Boolean)
        const workspace = selection.workspace?{...selection.workspace}:undefined
        if (!workspace) return
        let directory:string|undefined
        let unregister:(()=>Promise<void>)|undefined
        let server: ForwardingServer|undefined
        let retained = false
        const remote = selection.remote
        let disconnected: {unsubscribe():void}|undefined
        const cleanup = async () => {
            disconnected?.unsubscribe()
            await unregister?.()
            await server?.stop()
            if(directory)await rm(directory, { recursive: true, force: true })
            if (retained) { retained = false; remote?.unref() }
        }
        try {
            const source=selection.sourceTerminal??selection.terminal
            const terminalMode=Boolean(selection.terminalMode)
            if(terminalMode)workspace.id=`terminal:${randomUUID()}`
            const shared = terminalMode?undefined:this.projects?.connection(workspace.id, source)
            // A separate terminal must never replace another terminal’s catalog entry.
            if(remote && !terminalMode && !shared && this.projects?.connection(workspace.id)) workspace.id=`remote:${randomUUID()}`
            let customEnv: Record<string,string>
            try {
                customEnv = agentEnvironment(configured?.env)
            } catch (error) {
                this.notifications.error(t('AI 终端环境变量无效'), String(error instanceof Error ? error.message : error)); return
            }
            const env: Record<string,string> = { PATH: currentCliPath(join(__dirname,'arw.cjs')), ARW_WORKSPACE_ROOT: workspace.root, ARW_WORKSPACE_NAME: workspace.titleName??workspace.name,
                ARW_WORKSPACE_KIND: workspace.kind, ARW_AI_FRESH_START: '1',
                ...aiProxyEnvironment(configured?.proxyUrl), ...customEnv }
            const title=workspaceNames([workspace])[0]
            let cwd = workspace.root
            if (workspace.kind === 'remote'||terminalMode) {
                if (workspace.kind==='remote'&&!remote?.open) throw new Error(t('原 SSH 会话已断开'))
                if(remote){remote.ref(); retained = true}
                if (!shared) {
                    server = new ForwardingServer({ activityScope: remote ? activityScope(source) : undefined, workspace: { id: workspace.id, root: workspace.root, host: workspace.host },
                        terminalOnly:()=>isTerminalCommandMode(source),
                        copy: remote?sftpCopy(() => remote.openSFTP(), new RemotePathGuard(workspace.root, (command, signal) => workspace.run(command, signal))):undefined,
                        list: async path => ({ entries: await workspace.list(path) }),
                        read: async path => ({ path, ...await workspace.read(path) }),
                        write: async (path, content, _signal, expectedHash) => ({ path, ...await workspace.write(path, content, expectedHash) }),
                        run: (value, signal, options) => isTerminalCommandMode(source)?runTerminalCommand(source,workspace.root,value,signal,options?.maxBytes):workspace.run(value, signal, options),
                        validateCommand: workspace.validateCommand?.bind(workspace),
                    }, this.auditFile)
                    await server.start()
                    disconnected = remote?.willDestroy$.subscribe(() => { void server?.stop() })
                    if (remote&&!remote.open) throw new Error(t('SSH 会话已断开'))
                    directory=await mkdtemp(join(tmpdir(),'arw-forward-'))
                    const connectionPath=join(directory,'connection.json')
                    await writeFile(connectionPath,JSON.stringify(server.connection),{mode:0o600,flag:'wx'})
                    const configPath=this.platform.getConfigPath()
                    if(!configPath)throw new Error(t('无法定位 Tabby 的本地配置目录'))
                    unregister=await registerActiveWorkspace(join(dirname(configPath),'omw','workspaces.json'),{
                        workspaceId:workspace.id,workspaceRoot:workspace.root,name:title,host:workspace.host,
                        port:remote?.profile.options.port??22,user:remote?.authUsername??remote?.profile.options.user,
                        status:'forwarded',configPath:connectionPath,
                    })
                }
            }
            if(workspace.kind==='remote'&&remote){
                const configPath = this.platform.getConfigPath()
                if (!configPath) throw new Error(t('无法定位 Tabby 的本地配置目录'))
                const identity = {host:workspace.host ?? remote.profile.options.host,
                    port:remote.profile.options.port ?? 22,user:remote.authUsername ?? remote.profile.options.user ?? ''}
                const placeholder = await ensureAgentCwdPlaceholder(workspace.root, join(dirname(configPath), 'awm'), identity, terminalMode,terminalMode?workspace.id:undefined)
                cwd = placeholder.localPath
                env.ARW_LOCAL_WORKSPACE_ROOT = cwd
            }
            const opened = await this.profiles.openNewTabForProfile({ type: 'local', name: command.trim(),
                options: { command: command.trim(), args, cwd, env, pauseAfterExit: true } })
            if (!opened) throw new Error(t('无法创建 AI 终端'))
            const tab = opened && 'getFocusedTab' in opened ? (opened as any).getFocusedTab() as BaseTerminalTabComponent<any> : opened as BaseTerminalTabComponent<any>
            titleAiTabs([...(this.app?.tabs??[]).flatMap(value=>{
                const split=value as {getAllTabs?:()=>unknown[]}
                return typeof split.getAllTabs==='function'?split.getAllTabs():[value]
            }),tab] as any[])
            this.registry.pin(tab, selection)
            try { await this.placeBesideWorkspace(tab, selection) }
            catch (error) { this.notifications.error(t('AI 终端已启动，但无法放入右侧分屏'), String(error)) }
            tab.destroyed$.subscribe(() => { void cleanup() })
        } catch (error) { await cleanup(); this.notifications.error(t('AI CLI 启动失败'), String(error)) }
    }
}
