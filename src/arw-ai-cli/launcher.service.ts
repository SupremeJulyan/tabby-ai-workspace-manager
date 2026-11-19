import { wslLaunchDirectory } from '../shared/wsl-launch-directory'
import { isWslTerminal } from '../shared/wsl-directory'
import { wslBridgeEnvironment } from './wsl-bridge'
import { paneLayout, selectStackedPane } from '../shared/pane-layout'
import { orderedAiPanes } from './collapsed-panes'
import { isAiPane } from '../shared/pane-kind'
import { tileWorkspacePanes } from './tiling'
import { cliWorkspaceFiles } from '../arw-cli/workspace-files'
import { gitRelayOperation } from '../adapters/git-relay-operation'
import { activityScope } from '../arw-cli/agent-activity'
import { isTerminalCommandMode, runTerminalCommand } from '../shared/terminal-command'
import { randomUUID } from 'node:crypto'
import { t } from '../shared/i18n'
import { currentCliPath } from './cli-path'
import { workspaceCatalogPath, registerActiveWorkspace } from '../arw-cli/workspace-catalog'
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
import { titleAiTabs, workspaceNames } from '../shared/workspace-name'
import { agentShellFromOptions } from './agent-profile'
import { shellCommandLine, shellCommand, shellFamily, shellEnvironment, shellPathEnvironment, type AgentShell } from './shell'
import { launchShell, selectableShells } from './shell-selection'
import { configuredAiCommands, parseAiCommand } from './ai-command'
import { resumeArguments } from './recovery'

@Injectable()
export class AiLauncherService {
    private openingAiTerminals=0

    private hasAiTerminalSlot():boolean {
        const panes=(this.app?.tabs??[]).flatMap(tab=>'getAllTabs' in tab
            ? (tab as {getAllTabs():object[]}).getAllTabs() : [tab])
        return new Set(panes.filter(isAiPane)).size+this.openingAiTerminals<9
    }

    private async openAiTerminal(profile:Parameters<ProfilesService['openNewTabForProfile']>[0]) {
        if(!this.hasAiTerminalSlot())return
        this.openingAiTerminals++
        try {
            return await this.profiles.openNewTabForProfile(profile)
        } finally {
            this.openingAiTerminals--
        }
    }
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
            selectStackedPane(sourceSplit,'ai',tab,orderedAiPanes(sourceSplit,sourceSplit.getAllTabs().filter(isAiPane)))
            sourceSplit.focus(tab)
            tileWorkspacePanes(app,sourceSplit,true)
            return
        }
        // Tabs normally arrive already wrapped by AppService. Handle a legacy raw
        // terminal by attaching it to the AI tab's existing split instead.
        const ownSplit = app.getParentTab(tab)
        if (!ownSplit) return
        await ownSplit.add(source, tab, 'l')
        if (app.tabs.includes(source)) app.removeTab(source)
        app.selectTab(ownSplit)
        selectStackedPane(ownSplit,'ai',tab,orderedAiPanes(ownSplit,ownSplit.getAllTabs().filter(isAiPane)))
        ownSplit.focus(tab)
        tileWorkspacePanes(app,ownSplit,true)
    }
    /** Launch the command configured under Settings → ARW → AI CLI. */
    async launchConfigured (selection: WorkspaceSelection, agentId?:string): Promise<void> {
        if(!this.hasAiTerminalSlot())return
        const agents=configuredAiCommands(this.config.store.omw)
        const configured=agentId?agents.find(agent=>agent.id===agentId):agents[0]
        if(!configured){
            this.notifications.error(t(agents.length?'请先为此工作区选择 AI':'请先在 Tabby 设置中添加 AI 启动命令'));return
        }
        let command:string,args:string[],resumeCommand:string[]
        try{
            const parsed=parseAiCommand(configured.command)
            command=parsed.executable;args=parsed.args
            if(configured.resumeCommand.trim()){
                const parsedResume=parseAiCommand(configured.resumeCommand)
                resumeCommand=[parsedResume.executable,...parsedResume.args]
            }
            else resumeCommand=[command,...resumeArguments(command,args)]
            aiProxyEnvironment(configured.proxyUrl)
        }catch(error){this.notifications.error(t('AI 命令配置无效'),String(error));return}
        let shell:AgentShell|undefined
        try {
            const source=selection.sourceTerminal??selection.terminal
            if(source&&isWslTerminal(source)){
                shell=agentShellFromOptions(source.profile?.options)
            }else if(selection.workspace?.executionEnvironment==='wsl'){
                const distribution=wslLaunchDirectory(selection.workspace.root).distribution
                shell={command:'wsl.exe',args:distribution?['--distribution',distribution]:[],env:{},shellType:'unix'}
            }else{
                const profiles=await this.profiles.getProfiles({includeBuiltin:true})
                const available=selectableShells(profiles as any[])
                const sharedShell=this.config.store.omw?.aiShell as Partial<AgentShell>|undefined
                const legacyShell=(this.config.store.omw?.agent?.shell??configured.legacyShell) as Partial<AgentShell>|undefined
                shell=launchShell(available,sharedShell,legacyShell,this.config.store.terminal?.profile)
                if (!shell) {
                    throw new Error(t('未找到可用的 Tabby 本地 Shell'))
                }
            }
            if(!shell)throw new Error(t('未找到可用的 Tabby 本地 Shell'))
        } catch (error) { this.notifications.error(t('AI CLI 启动失败'),String(error)); return }
        const workspace = selection.workspace?{...selection.workspace}:undefined
        if (!workspace) return
        let directory:string|undefined
        let unregister:(()=>Promise<void>)|undefined
        let server: ForwardingServer|undefined
        let retained = false
        const releaseForwarding=workspace.kind==='remote'?this.projects?.retainForAi(workspace.id):undefined
        let agentCwd:string|undefined
        const remote = selection.remote
        let disconnected: {unsubscribe():void}|undefined
        let cleanupTask:Promise<void>|undefined
        const cleanup = async () => {
            if(cleanupTask)return cleanupTask
            const task=(async()=>{
                disconnected?.unsubscribe()
                await unregister?.()
                await server?.stop()
                if(directory)await rm(directory, { recursive: true, force: true })
                if (retained) { retained = false; remote?.unref() }
                releaseForwarding?.()
            })()
            cleanupTask=task
            try { await task }
            finally { if(cleanupTask===task)cleanupTask=undefined }
        }
        try {
            const source=selection.sourceTerminal??selection.terminal
            const terminalMode=Boolean(selection.terminalMode)
            if(terminalMode)workspace.id=`terminal:${randomUUID()}`
            const shared = terminalMode?undefined:this.projects?.connection(workspace.id, source)
            // A separate terminal must never replace another terminal’s catalog entry.
            if(remote && !terminalMode && !shared && this.projects?.connection(workspace.id)) workspace.id=`remote:${randomUUID()}`
            const title=workspaceNames([workspace])[0]
            const env: Record<string,string> = {
                PATH: currentCliPath(join(__dirname,'arw.cjs'),shellPathEnvironment(shell)),
                ARW_SESSION_WORKSPACE_ID: workspace.id,
                ARW_WORKSPACE_ROOT: workspace.root, ARW_WORKSPACE_NAME: workspace.titleName??workspace.name,
                ARW_WORKSPACE_KIND: workspace.kind, ARW_AI_FRESH_START: '1', ARW_PANE_LAYOUT:paneLayout(this.config.store.omw?.aiLayout),
                ...aiProxyEnvironment(configured.proxyUrl),
                ARW_AGENT_ID: configured.id, ARW_AGENT_COMMAND: command, ARW_AGENT_ARGS: JSON.stringify(args),
                ARW_AGENT_RESUME_COMMAND:JSON.stringify(resumeCommand),
                ARW_AGENT_SHELL_COMMAND: shell.command, ARW_AGENT_SHELL_ARGS: JSON.stringify(shell.args??[]),
            }
            if(shellFamily(shell)==='wsl'){
                const configPath=this.platform?.getConfigPath?.()
                if(configPath)env.TABBY_CONFIG_DIRECTORY=dirname(configPath)
            }
            if(workspace.kind==='remote'){
                env.ARW_WORKSPACE_HOST=remote?.profile.options.host??workspace.host
                env.ARW_WORKSPACE_PORT=String(remote?.profile.options.port??22)
                env.ARW_WORKSPACE_USER=remote?.authUsername??remote?.profile.options.user??''
            }
            if(workspace.kind==='remote'||terminalMode){
                const configPath=this.platform.getConfigPath()
                if(!configPath)throw new Error(t('无法定位 Tabby 的本地配置目录'))
                env.TABBY_CONFIG_DIRECTORY=dirname(configPath)
            }
            if (shell.shellType) env.ARW_AGENT_SHELL_TYPE=shell.shellType
            let agentCwd = workspace.root
            if (workspace.kind === 'remote'||terminalMode) {
                if (workspace.kind==='remote'&&!remote?.open) throw new Error(t('原 SSH 会话已断开'))
                if(remote){remote.ref(); retained = true}
                if (!shared) {
                    const cliFiles=cliWorkspaceFiles(workspace)
                    server = new ForwardingServer({ activityScope: remote ? activityScope(source) : undefined, workspace: { id: workspace.id, root: workspace.root, host: workspace.host },
                        terminalOnly:()=>isTerminalCommandMode(source),
                        git:remote?gitRelayOperation(remote,workspace.root,join(dirname(this.auditFile??workspaceCatalogPath()),'git-relay')):undefined,
                        copy: remote?sftpCopy(() => remote.openSFTP(), new RemotePathGuard(workspace.root, (command, signal) => workspace.run(command, signal))):undefined,
                        list: async path => ({ entries: await cliFiles.list(path) }),
                        read: async path => ({ path, ...await cliFiles.read(path) }),
                        write: async (path, content, _signal, expectedHash) => ({ path, ...await cliFiles.write(path, content, expectedHash, _signal) }),
                        run: (value, signal, options) => isTerminalCommandMode(source)?runTerminalCommand(source,workspace.root,value,signal,options?.maxBytes):workspace.run(value, signal, options),
                        validateCommand: workspace.validateCommand?.bind(workspace),
                    }, this.auditFile)
                    await server.start()
                    // Tear down the catalog entry as well as the socket. Otherwise
                    // arw keeps discovering a forwarded workspace whose endpoint is dead.
                    disconnected = remote?.willDestroy$.subscribe(() => { void cleanup() })
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
                    if(!remote?.open)throw new Error(t('SSH 会话已断开'))
                }
            }
            if(workspace.kind==='remote'&&remote){
                const configPath = this.platform.getConfigPath()
                if (!configPath) throw new Error(t('无法定位 Tabby 的本地配置目录'))
                const identity = {host:workspace.host ?? remote.profile.options.host,
                    port:remote.profile.options.port ?? 22,user:remote.authUsername ?? remote.profile.options.user ?? ''}
                const placeholder = await ensureAgentCwdPlaceholder(workspace.root, join(dirname(configPath), 'awm'), identity, terminalMode,terminalMode?workspace.id:undefined,
                    {version:2,kind:'remote',workspaceId:workspace.id,remoteRoot:workspace.root,host:identity.host,port:identity.port,user:identity.user,terminalOnly:terminalMode,catalogPath:join(dirname(configPath),'omw','workspaces.json')})
                agentCwd = placeholder.localPath
                env.ARW_LOCAL_WORKSPACE_ROOT = agentCwd
            }
            const shellOptions=wslBridgeEnvironment(shell.command,shellEnvironment(shell,env),join(__dirname,'arw.cjs'),agentCwd)
            for(const key of Object.keys(shellOptions))if(['arw_workspace_id','arw_terminal_mode'].includes(key.toLowerCase()))delete shellOptions[key]
            const launch=shellCommand({command:shell.command,args:shell.args??[],env:shellOptions,shellType:shell.shellType??null},[command].concat(args))
            const opened = await this.openAiTerminal({ type: 'local', name: shellCommandLine(launch),
                options: { command: launch.command, args: launch.args, cwd: agentCwd, env: launch.env,
                    shellType: launch.shellType, pauseAfterExit: true } })
            if(opened===undefined){await cleanup();return}
            if(!opened)throw new Error(t('无法创建 AI 终端'))
            const tab = opened && 'getFocusedTab' in opened ? (opened as any).getFocusedTab() as BaseTerminalTabComponent<any> : opened as BaseTerminalTabComponent<any>
            titleAiTabs([...(this.app?.tabs??[]).flatMap(value=>{
                const split=value as {getAllTabs?:()=>unknown[]}
                return typeof split.getAllTabs==='function'?split.getAllTabs():[value]
            }),tab] as any[])
            this.registry.pin(tab, selection)
            try {
                await this.placeBesideWorkspace(tab, selection)
            }
            catch (error) { this.notifications.error(t('AI 终端已启动，但无法放入右侧分屏'), String(error)) }
            tab.destroyed$.subscribe(() => { void cleanup() })
        } catch (error) { await cleanup(); this.notifications.error(t('AI CLI 启动失败'), String(error)) }
    }
}
