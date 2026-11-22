import { terminalLocalWorkspace } from '../adapters/wsl-workspace'
import { isWslTerminal, resolveTerminalWorkspacePath, wslHomeDirectory } from '../shared/wsl-directory'
import { workspaceRecoveryState } from '../shared/workspace-recovery'
import { selectedWorkspaceTerminal, selectWorkspaceTerminal as selectWorkspaceTerminalLayout, workspaceTerminalId } from '../shared/workspace-pane-visibility'
import { readWorkspaceBinding } from '../arw-cli/workspace-binding'
import { logOperation } from './operation-log'
import { t } from '../shared/i18n'
import { Injectable, NgZone } from '@angular/core'
import { AppService, BaseTabComponent, SplitTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { BehaviorSubject, Subject, Subscription } from 'rxjs'
import { isAbsolute } from 'path'
import { homedir } from 'os'
import { Workspace } from '../arw-tree/workspace'
import { remoteWorkspace } from '../adapters/remote-workspace'
import { isSshTab, SSHSession } from '../adapters/ssh-compat'
import { TabbyRelayTransport } from '../adapters/transport'
import { titleAiTabs, titleTerminalTab } from '../shared/workspace-name'

export interface WorkspaceSelection {
    terminalMode?:boolean
    terminal: BaseTerminalTabComponent<any>
    workspace?: Workspace
    remote?: SSHSession
    sourceTerminal?: BaseTerminalTabComponent<any>
    pathSource?: 'configured'|'restored'
    hint: string
}
interface RestoredWorkspace { host: string; port: number; user?: string; remoteRoot: string;workspaceId?:string;terminalOnly?:boolean }
interface RecordEntry { selection: WorkspaceSelection; root?: string; session?: unknown; version: number; pinned: boolean; restored?: RestoredWorkspace; subscriptions: Subscription[] }

function configuredRoot(terminal:BaseTerminalTabComponent<any>):string|undefined{
    const options=terminal.profile?.options??{}
    const saved=options.arwWorkspace??options.__getValue?.('arwWorkspace')
    let root=typeof saved?.root==='string'?saved.root:typeof options.cwd==='string'?options.cwd:undefined
    if(isWslTerminal(terminal)&&!root){
        const args:string[]=options.args??[]
        const index=args.findIndex(value=>value==='--cd'||value.startsWith('--cd='))
        if(index>=0)root=args[index]==='--cd'?args[index+1]:args[index].slice('--cd='.length)
    }
    return typeof root==='string'&&(root==='~'||isAbsolute(root))?root:undefined
}

@Injectable()
export class WorkspaceRegistry {
    readonly current = new BehaviorSubject<WorkspaceSelection|null>(null)
    readonly selectionChanged = new Subject<{terminal:BaseTerminalTabComponent<any>;selection:WorkspaceSelection}>()
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
        const selected=selectedWorkspaceTerminal(tab)
        if(selected&&registered.includes(selected as BaseTerminalTabComponent<any>))return selected as BaseTerminalTabComponent<any>
        const sources=registered.filter(terminal=>!this.entries.get(terminal)?.pinned
            && !terminal.profile?.options?.env?.ARW_WORKSPACE_ROOT)
        return sources.find(terminal=>!workspaceTerminalId(terminal))??sources[0]??registered[0]
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
    private async remoteHomeDirectory(remote:SSHSession):Promise<string>{
        const result=await new TabbyRelayTransport(remote,'/').run('printf %s "$HOME"',AbortSignal.timeout(15000),{operation:'读取 SSH 账号家目录'})
        const root=result.stdout.replace(/\r?\n$/,'')
        if(result.exitCode!==0||!root.startsWith('/')||/[\x00-\x1f\x7f]/.test(root))throw new Error(t('无法解析 SSH 账号家目录'))
        return root
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
                    const candidateIdentity=candidate?JSON.stringify([candidate.profile.id??null,candidate.profile.options.host,
                        candidate.profile.options.port??22,candidate.authUsername??candidate.profile.options.user??'']):undefined
                    const sameIdentity=candidate&&pinned.workspace.identityKey
                        ?candidateIdentity===pinned.workspace.identityKey
                        :candidate&&original&&candidate.profile.options.host===original.profile.options.host
                            &&(candidate.profile.options.port??22)===(original.profile.options.port??22)
                            &&(candidate.authUsername??candidate.profile.options.user)===(original.authUsername??original.profile.options.user)
                    const remote=candidate?.open&&sameIdentity?candidate:undefined
                    if(entry.selection.remote!==remote){
                        if(remote){
                            const backend=remoteWorkspace(remote,pinned.workspace.root)
                            const selection={...pinned,remote,sourceTerminal:source,workspace:{...backend,sourceWorkspace:backend,id:pinned.workspace.id}}
                            entry.selection=selection;this.pinnedSelections.set(terminal,selection)
                            this.selectionChanged.next({terminal,selection})
                        }else entry.selection={terminal,sourceTerminal:source,hint:t('等待来源终端重新连接 SSH…')}
                        if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    }
                }
                continue
            }
            const metadata = entry.restored
            if (!metadata || entry.pinned) continue
            const matches = [...this.entries.keys()].filter(candidate => {
                if (!isSshTab(candidate) || !candidate.sshSession?.open) return false
                const remote = candidate.sshSession
                const options = remote.profile.options
                return options.host === metadata.host && (options.port ?? 22) === metadata.port
                    && (remote.authUsername ?? options.user ?? '') === (metadata.user ?? '')
            })
            const workspaceMatches=metadata.workspaceId
                ?matches.filter(candidate=>workspaceTerminalId(candidate)===metadata.workspaceId):[]
            const source=workspaceMatches.length===1?workspaceMatches[0]
                :workspaceMatches.length>1?undefined
                :matches.length===1?matches[0]:undefined
            const remote = source && isSshTab(source) ? source.sshSession ?? undefined : undefined
            if (entry.selection.remote === remote && entry.selection.workspace?.root === metadata.remoteRoot) continue
            const env=terminal.profile?.options?.env
            const backend=remote?remoteWorkspace(remote,metadata.remoteRoot):undefined
            entry.selection = remote ? { terminal, sourceTerminal: source, remote, hint: '', pathSource: 'restored',terminalMode:metadata.terminalOnly??env?.ARW_TERMINAL_MODE==='1',
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
    selectWorkspaceTerminal(split:SplitTabComponent,terminal:BaseTerminalTabComponent<any>):void {
        selectWorkspaceTerminalLayout(split,terminal)
        this.activate(terminal)
    }
    bindWorkspaceTerminal(terminal:BaseTerminalTabComponent<any>,sourceTerminal:BaseTerminalTabComponent<any>,workspace:Workspace,remote?:SSHSession):void {
        this.pin(terminal,{terminal:sourceTerminal,sourceTerminal,workspace,remote,pathSource:'configured',hint:''})
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
    register (terminal: BaseTerminalTabComponent<any>): void {
        if (this.entries.has(terminal)) return
        if (!isSshTab(terminal) && terminal.profile?.type !== 'local') return
        const pinned = this.pinnedSelections.get(terminal)
        const entry: RecordEntry = { selection: pinned ?? { terminal, hint: t('请选择一个工作区路径') }, version: 0, pinned: Boolean(pinned), subscriptions: [] }
        this.entries.set(terminal, entry)
        this.refreshTerminalTitles()
        const inspect = async () => {
            if (entry.pinned || this.entries.get(terminal) !== entry) return
            const version = ++entry.version
            const session = terminal.session
            try {
                const remote = isSshTab(terminal) ? terminal.sshSession ?? undefined : undefined
                if (isSshTab(terminal) && !remote?.open) {
                    entry.selection={terminal,remote,hint:t('正在连接 SSH…')}
                    if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    return
                }
                const env=terminal.profile?.options?.env
                // A manual cd into a placeholder does not bind an ordinary local terminal.
                const binding=!remote&&env?.ARW_WORKSPACE_ROOT&&env?.ARW_LOCAL_WORKSPACE_ROOT?readWorkspaceBinding(env.ARW_LOCAL_WORKSPACE_ROOT,true):undefined
                if(binding){
                    if(!binding.targetOnly&&env?.ARW_WORKSPACE_ID&&env.ARW_WORKSPACE_ID!==binding.workspaceId)throw new Error(t('远程工作区占位符元数据无效'))
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
                entry.restored = undefined
                const saved=workspaceRecoveryState(terminal)
                let root=configuredRoot(terminal)??(saved?.root&&isAbsolute(saved.root)?saved.root:undefined)
                let pathSource:'configured'|'restored'=root&&root===saved?.root?'restored':'configured'
                if(isWslTerminal(terminal)){
                    if(!root||root==='~')root=await wslHomeDirectory(terminal)
                    else if(root.startsWith('/'))root=await resolveTerminalWorkspacePath(terminal,root)
                }else if(!root)root=remote?await this.remoteHomeDirectory(remote):homedir()
                else if(root==='~')root=homedir()
                if (version !== entry.version || this.entries.get(terminal) !== entry || entry.pinned) return
                if(!root){
                    entry.selection={terminal,remote,hint:t('请选择一个已配置工作路径的工作区')}
                    if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    return
                }
                const hint=pathSource==='restored'?t('已恢复上次工作区路径。'):''
                if(entry.root===root&&entry.session===session&&entry.selection.remote===remote&&entry.selection.workspace){
                    if(entry.selection.pathSource!==pathSource){
                        entry.selection={...entry.selection,pathSource,hint}
                        if(this.current.value?.terminal===terminal)this.emit(entry.selection)
                    }
                    return
                }
                entry.root=root;entry.session=session
                entry.selection={terminal,remote,pathSource,hint,workspace:remote?remoteWorkspace(remote,root):terminalLocalWorkspace(root,terminal)}
                if(this.current.value?.terminal===terminal||terminal.hasFocus)this.emit(entry.selection)
            } catch (error) {
                if (version !== entry.version || entry.pinned) return
                logOperation('读取配置工作区路径',{host:isSshTab(terminal)?terminal.sshSession?.profile.options.host:undefined,error:String(error)})
                if(entry.selection.workspace)return
                entry.selection = { terminal, remote:isSshTab(terminal)?terminal.sshSession??undefined:undefined, hint:t('请选择一个已配置工作路径的工作区') }
                if (this.current.value?.terminal === terminal) this.emit(entry.selection)
            } finally {
                if (isSshTab(terminal)) this.restoreBindings()
            }
        }
        let sessionSubscriptions: Subscription[] = []
        const watch = () => {
            sessionSubscriptions.forEach(subscription => subscription.unsubscribe())
            sessionSubscriptions = []
            // A reconnect can reuse the SSHSession wrapper while replacing its underlying client.
            // Force inspect() to create a fresh Workspace and transport for the new connection.
            entry.session = undefined
            const session = terminal.session
            if (session) {
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
        entry.subscriptions.push(new Subscription(() => sessionSubscriptions.forEach(subscription => subscription.unsubscribe())))
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
