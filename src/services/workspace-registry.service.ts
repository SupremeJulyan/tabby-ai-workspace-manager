import { isMsysTerminal } from '../shared/msys-directory'
import { isWslTerminal, terminalWorkspaceDirectory } from '../shared/wsl-directory'
import { workspaceRecoveryState } from '../shared/workspace-recovery'
import { readWorkspaceBinding } from '../arw-cli/workspace-binding'
import { logOperation } from './operation-log'
import { t } from '../shared/i18n'
import { Injectable, NgZone } from '@angular/core'
import { AppService, BaseTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { BehaviorSubject, Subject, Subscription, auditTime } from 'rxjs'
import { isAbsolute } from 'path'
import { Workspace, localWorkspace } from '../arw-tree/workspace'
import { prepareCwdIntegration } from '../adapters/shell-integration'
import { cwdIntegrationCommand, RemoteShell } from '../shared/shell-integration'
import { TabbyRelayTransport } from '../adapters/transport'
import { remoteWorkspace } from '../adapters/remote-workspace'
import { isSshTab, SSHSession } from '../adapters/ssh-compat'
import { optionalSftp } from '../adapters/optional-sftp'
import { titleAiTabs, titleTerminalTab } from '../shared/workspace-name'

export interface WorkspaceSelection {
    terminalMode?:boolean
    terminal: BaseTerminalTabComponent<any>
    workspace?: Workspace
    remote?: SSHSession
    sourceTerminal?: BaseTerminalTabComponent<any>
    pathSource?: 'terminal'|'sftp'
    hint: string
}
interface RestoredWorkspace { host: string; port: number; user?: string; remoteRoot: string;workspaceId?:string;terminalOnly?:boolean }
interface RecordEntry { selection: WorkspaceSelection; root?: string; session?: unknown; version: number; pinned: boolean; restored?: RestoredWorkspace; subscriptions: Subscription[] }

@Injectable()
export class WorkspaceRegistry {
    readonly current = new BehaviorSubject<WorkspaceSelection|null>(null)
    readonly selectionChanged = new Subject<{terminal:BaseTerminalTabComponent<any>;selection:WorkspaceSelection}>()
    private initialDirectories = new WeakMap<SSHSession, Promise<string>>()
    private entries = new Map<BaseTerminalTabComponent<any>, RecordEntry>()
    private pinnedSelections = new WeakMap<BaseTerminalTabComponent<any>, WorkspaceSelection>()
    constructor (private app: AppService, private zone: NgZone) {
        this.app.tabsChanged$?.subscribe(()=>this.refreshTerminalTitles())
        this.app.activeTabChange$.subscribe(tab => this.selectTab(tab))
    }
    private topTab(tab: any): any {
        const visited = new Set<object>()
        while (tab && !visited.has(tab)) {
            visited.add(tab)
            const parent = this.app.getParentTab?.(tab)
            if (!parent || visited.has(parent)) break
            tab = parent
        }
        return tab
    }
    private owner(tab: any): BaseTerminalTabComponent<any>|undefined {
        if (!tab) return undefined
        const terminals = (tab.getAllTabs?.() ?? [tab]) as BaseTerminalTabComponent<any>[]
        const registered = terminals.filter(terminal => this.entries.has(terminal))
        const source = registered.find(terminal => !this.entries.get(terminal)?.pinned
            && !terminal.profile?.options?.env?.ARW_WORKSPACE_ROOT)
        return source ?? registered[0]
    }
    private selectTab(tab: any): void {
        this.restoreBindings()
        const owner = this.owner(tab)
        this.emit(owner ? this.entries.get(owner)!.selection : null)
    }

    private refreshTerminalTitles():void {
        for(const terminal of this.entries.keys())titleTerminalTab(terminal)
        for(const tab of this.app.tabs??[]){
            if(!('getAllTabs' in tab))continue
            const terminals=(tab as any).getAllTabs() as BaseTerminalTabComponent<any>[]
            const source=terminals.find(terminal=>this.entries.has(terminal)&&terminal.profile?.name&&!terminal.profile.options?.env?.ARW_WORKSPACE_ROOT)
                ??terminals.find(terminal=>this.entries.has(terminal)&&terminal.profile?.name)
            if(source)titleTerminalTab(tab,source.profile.name)
        }
    }
    private emit(value:WorkspaceSelection|null):void{
        // Pane focus and late background updates must never select another top-level tab.
        const active = this.app.activeTab
        if (active && value) {
            if (this.topTab(value.terminal) !== active) return
            const owner = this.owner(active)
            if (owner) value = this.entries.get(owner)!.selection
        }
        if(this.current.value===value)return
        this.refreshTerminalTitles()
        const env=value?.terminal.profile?.options?.env
        if(env?.ARW_WORKSPACE_ROOT&&value?.workspace){
            env.ARW_WORKSPACE_KIND=value.workspace.kind
            titleAiTabs([value.terminal])
        }
        this.zone.run(()=>this.current.next(value))
    }
    private restoreBindings (): void {
        for (const [terminal, entry] of this.entries) {
            if(entry.pinned){
                const pinned=this.pinnedSelections.get(terminal),source=pinned?.sourceTerminal
                if(pinned?.workspace&&source&&isSshTab(source)){
                    const candidate=source.sshSession,original=pinned.remote
                    const sameIdentity=candidate&&original&&candidate.profile.options.host===original.profile.options.host
                        &&(candidate.profile.options.port??22)===(original.profile.options.port??22)
                        &&(candidate.authUsername??candidate.profile.options.user)===(original.authUsername??original.profile.options.user)
                    const remote=candidate?.open&&sameIdentity?candidate:undefined
                    if(entry.selection.remote!==remote){
                        if(remote){
                            const backend=remoteWorkspace(remote,pinned.workspace.root)
                            const selection={...pinned,remote,sourceTerminal:source,workspace:{...backend,sourceWorkspace:backend,id:pinned.workspace.id}}
                            entry.selection=selection;this.pinnedSelections.set(terminal,selection)
                        }else entry.selection={terminal,sourceTerminal:source,hint:t('等待来源终端重新连接 SSH…')}
                        if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    }
                }
                continue
            }
            const metadata = entry.restored
            if (!metadata || entry.pinned) continue
            const source = [...this.entries.keys()].find(candidate => {
                if (!isSshTab(candidate) || !candidate.sshSession?.open) return false
                const remote = candidate.sshSession
                const options = remote.profile.options
                return options.host === metadata.host && (options.port ?? 22) === metadata.port
                    && (remote.authUsername ?? options.user ?? '') === (metadata.user ?? '')
            })
            const remote = source && isSshTab(source) ? source.sshSession ?? undefined : undefined
            if (entry.selection.remote === remote && entry.selection.workspace?.root === metadata.remoteRoot) continue
            const env=terminal.profile?.options?.env
            const backend=remote?remoteWorkspace(remote,metadata.remoteRoot):undefined
            entry.selection = remote ? { terminal, sourceTerminal: source, remote, hint: '', pathSource: 'terminal',terminalMode:metadata.terminalOnly??env?.ARW_TERMINAL_MODE==='1',
                workspace: {...backend!,sourceWorkspace:backend,id:metadata.workspaceId??backend!.id} }
                : { terminal, hint: t`等待连接远程工作区：${metadata.host}:${metadata.port} ${metadata.remoteRoot}` }
            this.selectionChanged.next({terminal,selection:entry.selection})
            if (this.current.value?.terminal === terminal) this.emit(entry.selection)
        }
    }
    get (terminal: BaseTerminalTabComponent<any>): WorkspaceSelection|undefined { return this.entries.get(terminal)?.selection }
    activate (terminal: BaseTerminalTabComponent<any>): void {
        this.restoreBindings()
        const entry = this.entries.get(terminal)
        if (entry && this.current.value?.terminal !== terminal) this.emit(entry.selection)
    }
    pin (terminal: BaseTerminalTabComponent<any>, selection: WorkspaceSelection): void {
        const pinned = { ...selection, terminal, sourceTerminal:selection.sourceTerminal??selection.terminal }
        if (!this.pinnedSelections.has(terminal)) terminal.destroyed$?.subscribe(() => {
            this.pinnedSelections.delete(terminal)
            this.unregister(terminal)
        })
        this.pinnedSelections.set(terminal, pinned)
        let entry = this.entries.get(terminal)
        if (!entry) { this.register(terminal); entry = this.entries.get(terminal) }
        if (!entry) return
        entry.pinned = true
        entry.version++
        entry.selection = pinned
        this.emit(entry.selection)
    }
    prepareCwdIntegration (terminal:BaseTerminalTabComponent<any>, shell:RemoteShell) {
        if((isWslTerminal(terminal)||isMsysTerminal(terminal))&&terminal.session?.open)return Promise.resolve({command:cwdIntegrationCommand(shell),cleanup:async()=>{}})
        if(!isSshTab(terminal)||!terminal.sshSession?.open)throw new Error(t('SSH 会话尚未就绪'))
        return prepareCwdIntegration(terminal.sshSession,shell)
    }
    private initialDirectory (remote: SSHSession): Promise<string> {
        let pending=this.initialDirectories.get(remote)
        if(!pending){
            // Tabby's SFTP API exposes no realpath('.'). Resolve the login channel's initial
            // directory once, then validate it through SFTP. This is not the interactive shell's cwd.
            pending=new TabbyRelayTransport(remote,'.').run('pwd -P',AbortSignal.timeout(15000),{operation:'检测 SSH 登录初始目录'}).then(result=>{
                const root=result.stdout.replace(/\r?\n$/,'')
                if(result.exitCode!==0||!root.startsWith('/')||root.includes('\n')||root.includes('\0')){
                    throw new Error(t`无法解析远程初始目录：${result.stderr||t('pwd 未返回绝对路径')}`)
                }
                return root
            })
            this.initialDirectories.set(remote,pending)
            pending.catch(()=>{if(this.initialDirectories.get(remote)===pending)this.initialDirectories.delete(remote)})
        }
        return pending
    }
    register (terminal: BaseTerminalTabComponent<any>): void {
        if (this.entries.has(terminal)) return
        if (!isSshTab(terminal) && terminal.profile?.type !== 'local') return
        const pinned = this.pinnedSelections.get(terminal)
        const entry: RecordEntry = { selection: pinned ?? { terminal, hint: t('等待终端报告当前目录…') }, version: 0, pinned: Boolean(pinned), subscriptions: [] }
        this.entries.set(terminal, entry)
        this.refreshTerminalTitles()
        let sftpValidation: { remote: SSHSession; root: string; promise: Promise<void> }|undefined
        const inspect = async () => {
            if (entry.pinned || this.entries.get(terminal) !== entry) return
            const version = ++entry.version
            const session = terminal.session
            try {
                const reported = await terminalWorkspaceDirectory(terminal)
                if (version !== entry.version || this.entries.get(terminal) !== entry || entry.pinned) return
                const remote = isSshTab(terminal) ? terminal.sshSession ?? undefined : undefined
                if (isSshTab(terminal) && !remote?.open) {
                    entry.selection={terminal,remote,hint:t('正在连接 SSH…')}
                    if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    return
                }
                let root=reported && isAbsolute(reported)?reported:undefined
                const env=terminal.profile?.options?.env
                const binding=!remote&&(env?.ARW_LOCAL_WORKSPACE_ROOT||root)?readWorkspaceBinding(env?.ARW_LOCAL_WORKSPACE_ROOT??root!,true):undefined
                if(binding){
                    if(env?.ARW_WORKSPACE_ID&&env.ARW_WORKSPACE_ID!==binding.workspaceId)throw new Error(t('远程工作区占位符元数据无效'))
                    entry.restored=binding;this.restoreBindings();return
                }
                if (!remote && env?.ARW_WORKSPACE_ROOT && (env.ARW_LOCAL_WORKSPACE_ROOT||env.ARW_WORKSPACE_KIND==='remote')) {
                    const port=Number(env.ARW_WORKSPACE_PORT??22)
                    if(!env.ARW_WORKSPACE_HOST||!Number.isInteger(port)||port<1||port>65535||!env.ARW_WORKSPACE_ROOT.startsWith('/'))throw new Error(t('远程工作区占位符元数据无效'))
                    entry.restored = {host:env.ARW_WORKSPACE_HOST,port,user:env.ARW_WORKSPACE_USER,remoteRoot:env.ARW_WORKSPACE_ROOT}
                    env.ARW_WORKSPACE_KIND='remote';titleAiTabs([terminal])
                    this.restoreBindings()
                    return
                }
                if(!remote&&root&&/[\\/]agent-cwd[\\/]/.test(root))throw new Error(t('远程工作区占位符元数据无效'))
                entry.restored = undefined
                let pathSource:'terminal'|'sftp'='terminal'
                if(!root && remote && isSshTab(terminal)){
                    // Use the same authenticated session and browser path as Tabby's native SFTP panel.
                    const saved=workspaceRecoveryState(terminal)
                    const browser=(terminal.sftpPanelVisible||entry.root)?terminal.sftpPath:(saved?.cwd??saved?.root??terminal.sftpPath)
                    root=browser?.startsWith('/')&&(browser!=='/'||terminal.sftpPanelVisible||entry.root)
                        ?browser:await this.initialDirectory(remote)
                    if(version!==entry.version||this.entries.get(terminal)!==entry||entry.pinned)return
                    pathSource='sftp'
                }
                if(!root){
                    entry.selection={terminal,hint:t('正在检测本地终端目录…')}
                    if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    return
                }
                const hint=pathSource==='sftp'?t('当前显示远程浏览目录；终端尚未上报实际路径。'):''
                if(entry.root===root&&entry.session===session&&entry.selection.remote===remote&&entry.selection.workspace){
                    if(entry.selection.pathSource!==pathSource){
                        entry.selection={...entry.selection,pathSource,hint}
                        if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    }
                    return
                }
                if(pathSource==='sftp'&&remote){
                    if(sftpValidation?.remote!==remote||sftpValidation.root!==root){
                        const directory=root
                        sftpValidation={remote,root,promise:(async()=>{
                            const sftp=await optionalSftp(remote)
                            if(sftp){if(!(await sftp.stat(directory)).isDirectory)throw new Error(t('Tabby SFTP 当前路径不是目录'))}
                            else{
                                const result=await new TabbyRelayTransport(remote,directory).run('test -d . && test -r . && test -x .',AbortSignal.timeout(15000),{operation:'验证 SSH 工作区目录可访问性'})
                                if(result.exitCode!==0)throw new Error(result.stderr||t('SSH 当前路径不是可读取的目录'))
                            }
                        })()}
                    }
                    const validation=sftpValidation
                    try { await validation.promise }
                    finally { if(sftpValidation===validation)sftpValidation=undefined }
                    if(version!==entry.version||this.entries.get(terminal)!==entry||entry.pinned)return
                }
                if(pathSource==='sftp'&&isSshTab(terminal)&&!terminal.sftpPanelVisible&&(!terminal.sftpPath||terminal.sftpPath==='/'))terminal.sftpPath=root
                entry.root=root;entry.session=session
                entry.selection={terminal,remote,pathSource,hint,workspace:remote?remoteWorkspace(remote,root):localWorkspace(root)}
                if(this.current.value?.terminal===terminal||terminal.hasFocus)this.emit(entry.selection)
            } catch (error) {
                if (version !== entry.version || entry.pinned) return
                logOperation('自动检测终端工作目录',{host:isSshTab(terminal)?terminal.sshSession?.profile.options.host:undefined,error:String(error)})
                if(entry.selection.workspace)return
                entry.selection = { terminal, remote:isSshTab(terminal)?terminal.sshSession??undefined:undefined, hint:t('等待终端报告当前目录…') }
                if (this.current.value?.terminal === terminal) this.emit(entry.selection)
            } finally {
                if (isSshTab(terminal)) this.restoreBindings()
            }
        }
        let sessionSubscriptions: Subscription[] = []
        const watch = () => {
            sessionSubscriptions.forEach(subscription => subscription.unsubscribe())
            sessionSubscriptions = []
            const session = terminal.session
            if (session) {
                sessionSubscriptions.push(session.oscProcessor.cwdReported$.subscribe(() => { void inspect() }))
                if(session.output$)sessionSubscriptions.push(session.output$.pipe(auditTime(200)).subscribe(() => { if(this.current.value?.terminal===terminal||terminal.hasFocus)void inspect() }))
                sessionSubscriptions.push(session.destroyed$.subscribe(() => {
                    if (entry.pinned) return
                    entry.version++; entry.root = undefined
                    entry.selection = { terminal, hint: t('终端已断开') }
                    if (this.current.value?.terminal === terminal) this.emit(entry.selection)
                    this.restoreBindings()
                }))
            }
            void inspect()
        }
        entry.subscriptions.push(terminal.focused$.subscribe(() => {
            const switched=this.current.value?.terminal!==terminal
            this.activate(terminal)
            if(switched || !entry.selection.workspace)void inspect()
        }))
        entry.subscriptions.push(terminal.sessionChanged$.subscribe(watch))
        entry.subscriptions.push(new Subscription(() => sessionSubscriptions.forEach(subscription => subscription.unsubscribe())))
        if(isSshTab(terminal)){
            const timer=setInterval(()=>{
                if(terminal.sftpPanelVisible&&this.current.value?.terminal===terminal&&entry.selection.pathSource==='sftp'&&terminal.sftpPath!==entry.root)void inspect()
            },750)
            entry.subscriptions.push(new Subscription(()=>clearInterval(timer)))
        }
        watch()
        if (terminal.hasFocus || !this.current.value) this.activate(terminal)
    }
    unregister (terminal: BaseTerminalTabComponent<any>): void {
        const entry = this.entries.get(terminal)
        entry?.subscriptions.forEach(subscription => subscription.unsubscribe())
        this.entries.delete(terminal)
        this.restoreBindings()
        if (this.current.value?.terminal === terminal) {
            const tab = this.app.activeTab ?? this.topTab(terminal)
            this.selectTab(tab)
        }
    }
}
