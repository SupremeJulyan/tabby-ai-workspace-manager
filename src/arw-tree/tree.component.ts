import { rememberWorkspace, workspaceRecoveryState } from '../shared/workspace-recovery'
import { logOperation } from '../services/operation-log'
import { setTerminalCommandMode } from '../shared/terminal-command'
import { openFilePane } from './open-file-pane'
import { t } from '../shared/i18n'
import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy } from '@angular/core'
import { AppService, ConfigService, NotificationsService, PlatformService, TabsService } from 'tabby-core'
import { Subscription } from 'rxjs'
import { resolve, posix, relative, isAbsolute, sep } from 'node:path'
import { WorkspaceFile, Workspace, localWorkspace } from './workspace'
import { RemoteGit, GitChange, isGitConflict, parseGitStatus } from './git/remote-git'
import { readBackgroundGit } from './git/background-git'
import { workspaceGit } from './git/workspace-git'
import { workspacePath, parentWorkspacePath } from '../shared/workspace-path'
import { discoverGitRepositories } from './git/git-discovery'
import { cwdIntegrationCommand, RemoteShell } from '../shared/shell-integration'
import { WorkspaceRegistry, WorkspaceSelection } from '../services/workspace-registry.service'
import { ForwardingService } from '../arw-cli/forwarding.service'
import { GitTasksService } from '../services/git-tasks.service'
import { AiLauncherService } from '../arw-ai-cli/launcher.service'
import { remoteWorkspace } from '../adapters/remote-workspace'
import { uploadLocalPaths, droppedLocalPaths } from '../adapters/sftp-upload'
import { downloadSftpItem } from '../adapters/sftp-download'
import { isSshTab, SSHTabComponent } from '../adapters/ssh-compat'
import { ArwPreviewComponent } from './preview.component'
import { previewKind } from './preview/model'
import { ArwEditorComponent } from './editor.component'
import { refreshOpenedWorkspaceFiles } from '../services/opened-files.service'
import { workspaceNames } from '../shared/workspace-name'
import { ArwProject, ProjectStore } from './project.store'

import { TREE_TEMPLATE, TREE_STYLES } from './tree.view'
import { addedFilePatch } from './git/diff-model'
import { agentActivity, AgentActivity, activityScope } from '../arw-cli/agent-activity'
import { initializeRemoteGit, setupLocalGit, validateGitIdentity, cloneDirectory } from './git/git-bootstrap'
import { redactSensitiveText } from '../shared/redact'
import { shellQuote } from '../shared/shell-quote'
import { GitBranch, GitCommit } from './git/git-history'
import { GitSyncState, readGitSyncState, readCommitSyncHistory, syncStateLabel } from './git/git-sync-state'
import { LocalGitSyncAction, syncLocalGit } from './git/local-git-sync'

interface GitRepositoryView { workspace:Workspace; name:string; root:string; expanded:boolean; watchedStatus?:string; groups:Array<{title:string;staged:boolean;changes:GitChange[]}>; error:string; count:number; loading:boolean; busy?:boolean; message?:string; relayProgress?:string; syncState?:GitSyncState; syncError?:string; pushedCommits?:Set<string>; pulledCommits?:Set<string>;
    branch:string; branches:GitBranch[]; commits:GitCommit[]; inspector:string; inspectorLoading:boolean; inspectorError:string; inspectorPending?:boolean; inspectorVersion?:number; relayCancel?:()=>void }
interface GitScanCache {root:string;context:string;repositories:GitRepositoryView[];complete:boolean;notice:string}
interface TabState {
    gitScanCache:Map<string,GitScanCache>;
    catalog?:Workspace;
    browserWorkspace?:Workspace;
    nodes:TreeNode[];
    relativePath:string;
    activeProject:string;
    filterText:string;
    directoryDraft:string|null;
    directoryCandidates:string[];
    directoryCandidateIndex:number;
    directoryInputScroll:number;
    directoryCaretAtEnd:boolean;
    directoryListings:Map<string,{expires:number;files:Promise<WorkspaceFile[]>}>;
    mode:'files'|'git'|'activity';
    projectsExpanded:boolean;
    terminalMode:boolean;
    commitMessages:Map<string,string>;
    gitNoticeByRoot:Map<string,{error:string;message?:string}>;
    repositories:GitRepositoryView[];
    gitGroups:Array<{title:string;staged:boolean;changes:GitChange[]}>;
    gitWorkspace?:Workspace;
    gitNotice:string;
    gitScanCompleted:boolean;
    gitScope?:string;
    error:string;
    activityCategory:string;
    activityStatus:string;
    gitSetupMode:'init'|'clone'|null;
    gitSetupName:string;
    gitSetupEmail:string;
    gitSetupUrl:string;
    gitSetupDirectory:string;
    gitSetupRoot:string;
    gitSetupError:string;
    gitSetupProgress:string;
    cwdShell:RemoteShell;
    collapsed:Map<string,boolean>;
    viewScroll:{savedWorkspaces:number;browser:number;footer:number};
}
interface TreeNode extends WorkspaceFile { depth: number; expanded?: boolean; loading?: boolean }
@Component({
    selector: 'arw-tree',
    template: TREE_TEMPLATE,
    styles: [TREE_STYLES],
})
export class ArwTreeComponent implements AfterViewInit, OnDestroy {
    uploadBusy = false
    uploadPath = ''
    dropTarget: string|null = null
    private uploadController?: AbortController
    get canUpload (): boolean {
        return !!this.selection?.remote?.open && !this.terminalMode && !this.uploadBusy
            && (this.browserWorkspace ?? this.selection?.workspace)?.kind === 'remote'
    }
    dragLocalFiles (event: DragEvent, node?: TreeNode): void {
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault(); event.stopPropagation()
        event.dataTransfer.dropEffect = this.canUpload ? 'copy' : 'none'
        this.dropTarget = this.canUpload ? (node?.directory && !node.symlink ? node.path : '.') : null
    }
    leaveLocalFiles (event: DragEvent): void {
        if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        this.dropTarget = null
    }
    cancelUpload (): void { this.uploadController?.abort() }
    async dropLocalFiles (event: DragEvent, node?: TreeNode): Promise<void> {
        event.preventDefault(); event.stopPropagation(); this.dropTarget = null
        if (!this.canUpload || !event.dataTransfer) return
        const workspace = this.browserWorkspace ?? this.selection?.workspace, remote = this.selection?.remote
        if (!workspace || !remote) return
        const target = node?.directory && !node.symlink ? node.path : this.relativePath || '.'
        const tab = this.activeTab, version = this.version
        const controller = new AbortController()
        this.uploadController = controller; this.uploadBusy = true; this.error = ''; this.render()
        try {
            const paths = droppedLocalPaths(event.dataTransfer.files, file => {
                const electron = require('electron') as {webUtils?: {getPathForFile(file: File): string}}
                return electron.webUtils?.getPathForFile(file) || (file as File & {path?: string}).path || ''
            })
            await uploadLocalPaths(remote, workspace, paths, target, controller.signal, path => {this.uploadPath = path; this.render()})
        } catch (error) {
            if (!controller.signal.aborted) this.notifications.error(t('上传失败'), String(error))
        } finally {
            this.uploadBusy = false; this.uploadPath = ''; this.uploadController = undefined
            if (tab === this.activeTab && version === this.version) await this.refreshFiles({preserveError: true})
            this.render()
        }
    }
    selection: WorkspaceSelection|null = null
    directoryDraft: string|null = null
    get directoryInput (): string { return this.directoryDraft ?? this.breadcrumb }
    copyDirectory (): void {
        this.platform.setClipboard({text:this.directoryInput})
    }
    directoryCandidates: string[] = []
    directoryCandidateIndex = 0
    directoryInputScroll = 0
    directoryCaretAtEnd = true
    get directoryGhost (): string {
        const candidate=this.directoryCandidates[this.directoryCandidateIndex]
        return this.directoryCaretAtEnd&&candidate?.toLocaleLowerCase().startsWith(this.directoryInput.toLocaleLowerCase())
            ? candidate.slice(this.directoryInput.length) : ''
    }
    syncDirectoryCaret (input: HTMLInputElement): void {
        this.directoryInputScroll=input.scrollLeft
        this.directoryCaretAtEnd=input.selectionStart===input.value.length&&input.selectionEnd===input.value.length
        this.rememberIfTabbed()
    }
    private directoryCompletionVersion = 0
    private directoryListings = new Map<string,{expires:number; files:Promise<WorkspaceFile[]>}>()
    closeDirectoryCandidates (): void {
        this.directoryCompletionVersion++
        this.directoryCandidates=[]
        this.render()
    }
    async updateDirectoryCandidates (value: string): Promise<void> {
        this.directoryDraft=value
        this.rememberBrowsing()
        const version=++this.directoryCompletionVersion,tab=this.activeTab
        this.directoryCandidates=[]
        this.directoryCandidateIndex=0
        const workspace=this.browserWorkspace ?? this.selection?.workspace
        if(!workspace)return
        const separator=workspace.kind==='remote'||!/^[A-Za-z]:[\\/]/.test(value)?'/':'\\'
        const slash=Math.max(value.lastIndexOf('/'),value.lastIndexOf('\\'))
        const prefix=value.slice(slash+1)
        if(prefix==='.'||prefix==='..')return
        const base=slash>=0?value.slice(0,slash+1):''
        const parent=workspace.kind==='remote'?posix.resolve(this.breadcrumb,base||'.'):resolve(this.breadcrumb,base||'.')
        const target=workspace.kind==='local'?localWorkspace(parent)
            :this.selection?.remote?remoteWorkspace(this.selection.remote,parent):undefined
        if(!target)return
        try {
            let listing=this.directoryListings.get(parent)
            if(!listing||listing.expires<Date.now()){
                if(this.directoryListings.size>=32)this.directoryListings.delete(this.directoryListings.keys().next().value!)
                const files=target.list('.')
                listing={expires:Infinity,files}
                this.directoryListings.set(parent,listing)
                const current=listing
                void files.then(()=>{current.expires=Date.now()+5000},()=>{
                    if(this.directoryListings.get(parent)===current)this.directoryListings.delete(parent)
                })
            }
            const entries=await listing.files
            if(tab!==this.activeTab||version!==this.directoryCompletionVersion||workspace!==(this.browserWorkspace??this.selection?.workspace))return
            this.directoryCandidates=entries.filter(entry=>entry.directory&&entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
                .sort((left,right)=>left.name.localeCompare(right.name)).map(entry=>base+entry.name+separator)
            this.rememberBrowsing()
            this.render()
        } catch { if(tab===this.activeTab&&version===this.directoryCompletionVersion)this.closeDirectoryCandidates() }
    }
    moveDirectoryCandidate (offset: number): void {
        const count=this.directoryCandidates.length
        if(count)this.directoryCandidateIndex=(this.directoryCandidateIndex+offset+count)%count
        this.rememberBrowsing()
        this.render()
    }
    acceptDirectoryCandidate (index=this.directoryCandidateIndex): void {
        const candidate=this.directoryCandidates[index]
        if(candidate===undefined)return
        this.directoryDraft=candidate
        this.closeDirectoryCandidates()
        this.rememberBrowsing()
    }
    async completeDirectory (input?: HTMLInputElement): Promise<void> {
        if(!this.directoryCandidates.length)await this.updateDirectoryCandidates(input?.value??this.directoryInput)
        this.acceptDirectoryCandidate()
        if(input){input.value=this.directoryInput;input.setSelectionRange(input.value.length,input.value.length);this.syncDirectoryCaret(input)}
    }
    completeDirectoryRight (event: KeyboardEvent, input: HTMLInputElement): void {
        if(event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.isComposing)return
        this.syncDirectoryCaret(input)
        if(!this.directoryGhost)return
        event.preventDefault()
        void this.completeDirectory(input)
    }
    async navigateDirectory (): Promise<void> {
        this.closeDirectoryCandidates()
        const workspace=this.browserWorkspace ?? this.selection?.workspace
        if(!workspace)return
        const input=this.directoryInput.trim()
        if(!input)return
        const terminal=this.selection?.terminal
        const version=this.version
        try {
            const root=workspace.kind==='remote'?posix.resolve(this.breadcrumb,input):resolve(this.breadcrumb,input)
            const target=workspace.kind==='remote' && this.selection?.remote?remoteWorkspace(this.selection.remote,root):workspace.kind==='local'?localWorkspace(root):undefined
            if(!target)return
            await target.list('.')
            if(version!==this.version || terminal!==this.selection?.terminal)return
            this.directoryDraft=null
            await this.showWorkspace(target)
        } catch(error) { if(version===this.version){this.error=String(error);this.render()} }
    }
    hint = t('选择一个本地或 SSH 终端')
    cwdShell:RemoteShell='bash'
    cwdSetupPending=false
    cwdSetupError=''
    private cwdSetupCleanup?:()=>Promise<void>
    private cwdSetupVersion=0
    private clearCwdSetup():void{
        this.cwdSetupVersion++;clearTimeout(this.cwdSetupTimer)
        const cleanup=this.cwdSetupCleanup;this.cwdSetupCleanup=undefined;void cleanup?.()
    }
    private cwdSetupTimer?:ReturnType<typeof setTimeout>
    mode: 'files'|'git'|'activity' = 'files'
    private viewScroll={savedWorkspaces:0,browser:0,footer:0}
    private get currentActivityScopes (): Set<string> {
        if (!this.isRemote || !this.source) return new Set()
        const tab=this.browsingKey(this.selection) as {getAllTabs?:()=>object[]}|undefined
        return new Set([this.source, ...(tab?.getAllTabs?.() ?? [])].map(terminal=>activityScope(terminal)))
    }
    get activities (): AgentActivity[] { const scopes=this.currentActivityScopes; return agentActivity.snapshot().filter(event=>Boolean(event.terminalScope && scopes.has(event.terminalScope))) }
    activityCategory = 'all'
    activityStatus = 'all'
    private unsubscribeActivity = agentActivity.subscribe(() => { this.render() })
    get visibleActivities (): AgentActivity[] {
        return this.activities.filter(event => (this.activityCategory === 'all' || event.category === this.activityCategory)
            && (this.activityStatus === 'all' || event.status === this.activityStatus || (this.activityStatus === 'error' && event.status === 'denied')))
    }
    get runningActivities (): number { return this.activities.filter(event => event.status === 'running').length }
    trackActivity (_index: number, event: AgentActivity): number { return event.id }
    activityLabel (event: AgentActivity): string {
        return ({remote_upload:t('上传文件'), remote_download:t('下载文件'), remote_git_pull:t('通过本地 Git 拉取'), remote_git_push:t('通过本地 Git 推送'), remote_list:t('列出目录'), remote_read:t('读取文件'), remote_write:t('写入文件'), run_remote_command:t('执行命令'), list_remote_workspaces:t('查询工作区')} as Record<string,string>)[event.operation] ?? t('无效请求')
    }
    activityState (event: AgentActivity): string {
        return {running:t('执行中'), success:t('成功'), error:t('失败'), denied:t('已拦截')}[event.status]
    }
    async clearActivities (): Promise<void> {
        const scopes=this.currentActivityScopes
        if (!scopes.size) return
        const confirmation = await this.platform.showMessageBox({type:'warning', message:t('清空当前标签页已完成的 AI 活动？执行中的活动和安全审计日志会保留。'), buttons:[t('取消'),t('清空')], defaultId:0, cancelId:0})
        if (confirmation.response === 1) { for(const scope of scopes)agentActivity.clear(scope); this.rememberIfTabbed() }
    }
    nodes: TreeNode[] = []
    relativePath = ''
    loading = false
    manualRefreshing = false
    private manualRefreshRequest = 0
    gitLoading = false
    private gitWorkspace?:Workspace
    repositories:GitRepositoryView[]=[]
    gitNoticeByRoot=new Map<string,{error:string;message?:string}>()
    gitNotice=''
    private collapsed=new Map<string,boolean>()
    private gitScanCompleted=false
    private gitScope?:string
    private treeRequest=0
    private gitVersion=0
    private gitAbort?:AbortController
    private gitScan?:Promise<void>
    private gitScanCache=new Map<string,GitScanCache>()
    private gitNeedsScan=false
    error = ''
    dismissError(field:'error'|'gitSetupError'|'cwdSetupError'='error'):void{
        this[field]='';this.rememberIfTabbed();this.render()
    }
    dismissRepositoryError(repository:GitRepositoryView,field:'error'|'inspectorError'='error'):void{
        repository[field]=''
        if(field==='error'){
            const notice=this.gitNoticeByRoot.get(repository.root)
            if(notice)this.gitNoticeByRoot.set(repository.root,{...notice,error:''})
        }
        this.rememberIfTabbed();this.render()
    }
    gitGroups: Array<{title:string; staged:boolean; changes:GitChange[]}> = []
    private version = 0
    private subscription: Subscription
    projects: ArwProject[] = []
    activeProject = ''
    projectsExpanded = true
    terminalMode = false
    commitMessages = new Map<string,string>()
    private browserWorkspace?: Workspace
    private tabStates=new WeakMap<object,TabState>()
    private activeTab?:object
    private browsingKey(selection:WorkspaceSelection|null):object|undefined{
        let tab:object|undefined=selection?.terminal
        const visited=new Set<object>()
        while(tab&&!visited.has(tab)){
            visited.add(tab)
            const parent=this.app.getParentTab?.(tab as any)
            if(!parent||visited.has(parent))break
            tab=parent
        }
        return tab
    }
    private stateSnapshot(captureScroll=true):TabState{
        if(captureScroll)this.captureScroll()
        return {
            gitScanCache:new Map(this.gitScanCache),
            catalog:this.selection?.workspace,browserWorkspace:this.browserWorkspace,nodes:this.nodes,
            relativePath:this.relativePath,activeProject:this.activeProject,filterText:this.filterText,
            directoryDraft:this.directoryDraft,directoryCandidates:[...this.directoryCandidates],directoryCandidateIndex:this.directoryCandidateIndex,
            directoryInputScroll:this.directoryInputScroll,directoryCaretAtEnd:this.directoryCaretAtEnd,directoryListings:new Map(this.directoryListings),
            mode:this.mode,projectsExpanded:this.projectsExpanded,terminalMode:this.terminalMode,
            commitMessages:new Map(this.commitMessages),
            gitNoticeByRoot:new Map(this.gitNoticeByRoot),repositories:[...this.repositories],gitGroups:[...this.gitGroups],
            gitWorkspace:this.gitWorkspace,gitNotice:this.gitNotice,gitScanCompleted:this.gitScanCompleted,gitScope:this.gitScope,
            error:this.error,activityCategory:this.activityCategory,activityStatus:this.activityStatus,
            gitSetupMode:this.gitSetupMode,gitSetupName:this.gitSetupName,gitSetupEmail:this.gitSetupEmail,gitSetupUrl:this.gitSetupUrl,
            gitSetupDirectory:this.gitSetupDirectory,gitSetupRoot:this.gitSetupRoot,gitSetupError:this.gitSetupError,gitSetupProgress:this.gitSetupProgress,
            cwdShell:this.cwdShell,
            collapsed:new Map(this.collapsed),viewScroll:{...this.viewScroll},
        }
    }
    private saveActiveState(captureScroll=true):void{
        if(!this.activeTab)return
        this.tabStates.set(this.activeTab,this.stateSnapshot(captureScroll))
        const terminal=this.selection?.terminal
        if(terminal&&this.browserWorkspace)rememberWorkspace(terminal,this.breadcrumb,this.mode)
    }
    private captureScroll():void{
        if(!this.viewReady||typeof document==='undefined')return
        const saved=document.querySelector<HTMLElement>('.arw-tree-host .saved-workspaces')
        const browser=document.querySelector<HTMLElement>('.arw-tree-host .browser-area')
        const footer=document.querySelector<HTMLElement>('.arw-tree-host .workspace-footer')
        if(saved)this.viewScroll.savedWorkspaces=saved.scrollTop
        if(browser)this.viewScroll.browser=browser.scrollTop
        if(footer)this.viewScroll.footer=footer.scrollTop
    }
    private restoreScroll(scroll:{savedWorkspaces:number;browser:number;footer:number}):void{
        this.viewScroll={...scroll}
        if(!this.viewReady)return
        const tab=this.activeTab,version=this.version
        setTimeout(()=>{
            if(tab!==this.activeTab||version!==this.version)return
            const set=(selector:string,value:number)=>{const element=document.querySelector<HTMLElement>(`.arw-tree-host ${selector}`);if(element)element.scrollTop=value}
            set('.saved-workspaces',scroll.savedWorkspaces);set('.browser-area',scroll.browser);set('.workspace-footer',scroll.footer)
        })
    }
    private restoreTabState(key:object,selection:WorkspaceSelection):void{
        const state=this.tabStates.get(key)
        if(!state){
            this.resetVisibleState()
            const saved=workspaceRecoveryState(selection.terminal)
            if(saved&&selection.workspace){
                this.mode=saved.mode==='activity'&&!selection.remote?'files':saved.mode
                const workspace=selection.remote?remoteWorkspace(selection.remote,saved.root):localWorkspace(saved.root)
                void this.showWorkspace(workspace,true)
            }else void this.refresh(true)
            return
        }
        this.gitAbort?.abort();this.gitAbort=undefined;this.version++;this.treeRequest++;this.gitVersion++
        this.restoreLoadedState(state,selection)
    }
    private resetVisibleState():void{
        this.manualRefreshRequest++;this.manualRefreshing=false
        this.version++;this.treeRequest++;this.gitVersion++
        this.gitAbort?.abort();this.gitAbort=undefined
        this.gitScanCache=new Map();this.gitNeedsScan=false
        this.loading=false;this.gitLoading=false;this.browserWorkspace=undefined
        this.nodes=[];this.relativePath='';this.filterText='';this.directoryDraft=null;this.directoryCandidates=[]
        this.directoryCandidateIndex=0;this.directoryInputScroll=0;this.directoryCaretAtEnd=true;this.directoryListings.clear()
        this.mode='files';this.projectsExpanded=true;this.terminalMode=false
        this.commitMessages=new Map();this.gitNoticeByRoot=new Map();this.repositories=[];this.gitGroups=[];this.gitWorkspace=undefined
        this.gitNotice='';this.gitScanCompleted=false;this.gitScope=undefined;this.error='';this.collapsed=new Map()
        this.activityCategory='all';this.activityStatus='all'
        this.gitSetupMode=null;this.gitSetupName='';this.gitSetupEmail='';this.gitSetupUrl='';this.gitSetupDirectory='';this.gitSetupRoot=''
        this.gitSetupError='';this.gitSetupBusy=false;this.gitSetupProgress=''
        this.cwdShell='bash'
        this.viewScroll={savedWorkspaces:0,browser:0,footer:0};this.projects=[];this.activeProject=''
    }
    private restoreLoadedState(state:TabState,selection:WorkspaceSelection):void{
        this.manualRefreshRequest++;this.manualRefreshing=false
        this.gitScanCache=new Map(state.gitScanCache);this.gitNeedsScan=false
        this.browserWorkspace=state.browserWorkspace?.kind==='remote'&&selection.remote
            ? remoteWorkspace(selection.remote,state.browserWorkspace.root) : state.browserWorkspace
        this.nodes=state.nodes;this.relativePath=state.relativePath;this.filterText=state.filterText
        this.directoryDraft=state.directoryDraft;this.directoryCandidates=state.directoryCandidates
        this.directoryCandidateIndex=state.directoryCandidateIndex;this.directoryInputScroll=state.directoryInputScroll;this.directoryCaretAtEnd=state.directoryCaretAtEnd
        this.directoryListings=new Map(state.directoryListings)
        this.mode=state.mode==='activity'&&!this.isRemote?'files':state.mode;this.projectsExpanded=state.projectsExpanded;this.terminalMode=this.isRemote && state.terminalMode
        this.commitMessages=new Map(state.commitMessages)
        this.gitNoticeByRoot=new Map(state.gitNoticeByRoot);this.repositories=state.repositories;this.gitGroups=state.gitGroups
        this.gitWorkspace=state.gitWorkspace;this.gitNotice=state.gitNotice;this.gitScanCompleted=state.gitScanCompleted;this.gitScope=state.gitScope
        this.error=state.error;this.collapsed=new Map(state.collapsed)
        this.activityCategory=state.activityCategory;this.activityStatus=state.activityStatus
        this.gitSetupMode=state.gitSetupMode;this.gitSetupName=state.gitSetupName;this.gitSetupEmail=state.gitSetupEmail
        this.gitSetupUrl=state.gitSetupUrl;this.gitSetupDirectory=state.gitSetupDirectory;this.gitSetupRoot=state.gitSetupRoot
        this.gitSetupError=state.gitSetupError;this.gitSetupProgress=state.gitSetupProgress
        this.cwdShell=state.cwdShell
        this.loading=false;this.gitLoading=false
        this.loadProjects(selection.workspace);this.activeProject=state.activeProject
        this.restoreScroll(state.viewScroll);this.render()
        if(!this.browserWorkspace){void this.refresh(true);return}
        this.watchWorkspace()
    }
    private projectContext (workspace: Workspace): Workspace {
        const remote = this.selection?.remote
        return remote ? { ...workspace, host: JSON.stringify([workspace.host, remote.profile.options.port ?? 22, remote.authUsername ?? remote.profile.options.user ?? '']) } : workspace
    }
    private savedWorkspace (project: ArwProject): Workspace|undefined {
        const base = this.selection?.workspace
        if (!base) return undefined
        const workspace = base.kind === 'local' ? localWorkspace(project.root)
            : this.selection?.remote ? remoteWorkspace(this.selection.remote, project.root) : undefined
        return workspace ? {...workspace,sourceWorkspace:workspace,id:project.id} : undefined
    }
    constructor (private registry: WorkspaceRegistry, private app: AppService,
        private notifications: NotificationsService, private forwarding: ForwardingService,
        private tasks: GitTasksService, private ai: AiLauncherService, private platform: PlatformService,
        private projectStore?: ProjectStore, private changeDetector?: ChangeDetectorRef, private config?:ConfigService, private tabs?:TabsService) {
        this.subscription = registry.current.subscribe(next => {
            if(next?.terminal!==this.selection?.terminal||(next?.workspace&&next.pathSource!=='sftp')){
                this.cwdSetupPending=false;this.cwdSetupError='';this.clearCwdSetup()
            }
            const nextTab=this.browsingKey(next),tabChanged=nextTab!==this.activeTab
            if(tabChanged||!next?.workspace)this.saveActiveState()
            if((tabChanged||!next?.workspace)&&this.selection?.workspace)this.stopForwarding()
            if (!next?.workspace) {
                this.activeTab=nextTab;this.selection=next;this.resetVisibleState()
                this.hint=next?.hint ?? t('选择一个本地或 SSH 终端');this.render()
                return
            }
            const sameRemote=this.selection?.remote===next.remote
            if(!tabChanged&&this.browserWorkspace&&this.selection?.workspace&&sameRemote){
                if(this.selection.terminal!==next.terminal)this.selection=next
                this.restoreProjectForwarding();this.rememberBrowsing();return
            }
            if(!tabChanged&&this.browserWorkspace)this.saveActiveState()
            this.activeTab=nextTab;this.selection=next
            if(nextTab)this.restoreTabState(nextTab,next)
            else {this.resetVisibleState();void this.refresh(true)}
        })
        this.subscription.add(this.projectStore?.changed?.subscribe(()=>this.render()))
        this.subscription.add(new Subscription(() => this.disposeWorkspaceWatch()))
    }
    projectForwarding(project:ArwProject):string {return this.projectStore?.state?.(project.id).phase??'saved'}
    projectForwardingTitle(project:ArwProject):string {
        if (!this.isRemote) return project.root
        const state=this.projectStore?.state?.(project.id),labels={saved:t('未转发'),starting:t('正在建立转发'),forwarding:t('转发中'),error:t('转发失败（最近请求或连接出错）')}
        return [project.root,labels[state?.phase??'saved'],...(state?.logs.length?[t('最近错误日志：'),...state.logs]:[])].join('\n')
    }
    private viewReady = false
    private render (): void {
        if (this.viewReady) this.changeDetector?.detectChanges()
    }
    filterText = ''
    toggleProjects ():void {this.projectsExpanded=!this.projectsExpanded;this.rememberIfTabbed()}
    updateFilter (value:string):void {this.filterText=value;this.rememberIfTabbed()}
    setActivityCategory (value:string):void {this.activityCategory=value;this.rememberIfTabbed()}
    setActivityStatus (value:string):void {this.activityStatus=value;this.rememberIfTabbed()}
    private autoFetchRequest=0
    private autoFetch?:Promise<void>
    setMode (mode:'files'|'git'|'activity'):void{
        if(mode==='activity'&&!this.isRemote)return
        const enteringGit=mode==='git'&&this.mode!=='git'
        if(mode!==this.mode)this.autoFetchRequest++
        this.mode=mode
        if(this.selection?.workspace)this.rememberBrowsing()
        if(enteringGit)this.autoFetch=this.fetchOnGitEntry(this.autoFetchRequest)
        this.render()
    }
    private async fetchOnGitEntry(request:number):Promise<void>{
        const tab=this.activeTab,workspace=this.selection?.workspace
        const active=()=>request===this.autoFetchRequest&&tab===this.activeTab&&workspace===this.selection?.workspace&&this.mode==='git'
        if(!workspace)return
        try{
            if(!this.browserWorkspace)await this.refresh()
            this.ensureGitScan()
            await this.gitScan
            if(!active())return
            for(const repository of [...this.repositories]){
                if(!active())return
                if(repository.busy||repository.loading)continue
                if(repository.workspace.kind==='remote'&&!['tracked','missing-upstream'].includes(repository.syncState?.kind??''))continue
                await this.syncGit('fetch',repository,true)
            }
        }catch(error){logOperation('自动提取 Git 上游状态',{root:workspace.root,error:String(error)})}
    }
    private loadProjects (workspace?: Workspace): void {
        const root=this.browserWorkspace?this.breadcrumb:workspace?.root
        this.projects = this.terminalMode
            ? root ? [{id:'terminal',name:root,root}] : []
            : workspace && this.projectStore ? this.projectStore.list(this.projectContext(workspace)) : []
        const names=workspaceNames(this.projects.map(project=>({kind:workspace?.kind??'local',root:project.root})),false)
        this.projects=this.projects.map((project,index)=>({...project,name:names[index]}))
        this.activeProject = this.projects.find(project=>project.root===this.breadcrumb)?.id ?? ''
        this.restoreProjectForwarding()
    }
    private restoreProjectForwarding():void {
        // Remote forwarding is acquired by AI terminals, not by browsing a workspace.
    }
    get currentFolder (): string { return this.breadcrumb }
    async addProject (): Promise<void> {
        const workspace = this.selection?.workspace
        if (!workspace || !this.projectStore || this.terminalMode) return
        const tab=this.activeTab
        const project = await this.projectStore.add(this.projectContext(workspace), this.currentFolder)
        if(tab!==this.activeTab)return
        this.loadProjects(workspace)
        if (!project) { this.notifications.info(t('此目录已在工作区列表中')); return }
        this.projectsExpanded=true;this.activeProject=project.id;this.render()
        const backend=this.savedWorkspace(project)
        if (backend?.kind === 'remote') {
            try { await this.projectStore.open(project,backend,this.selection?.remote,this.selection?.sourceTerminal??this.selection?.terminal) }
            catch (error) { if(tab===this.activeTab){this.error=t`工作区已保存，但转发开启失败：${String(error)}`;this.render()} }
        }
    }
    async selectProject (project: ArwProject): Promise<void> {
        const workspace = this.savedWorkspace(project)
        if (!workspace) return
        const terminal=this.selection?.sourceTerminal??this.selection?.terminal
        if(terminal?.session?.open&&!terminal.alternateScreenActive){
            try{terminal.sendInput(` cd -- ${shellQuote(workspace.root)}\r`)}
            catch(error){logOperation('切换终端工作目录',{root:workspace.root,error:String(error)})}
        }
            this.mode = 'files'
        this.filterText = ''
        this.activeProject = project.id
        this.render()
        await this.showWorkspace(workspace)
    }
    async removeProject (project: ArwProject, event?: Event): Promise<void> {
        event?.stopPropagation()
        if(this.terminalMode)return
        const base = this.selection?.workspace
        if (!base || !this.projectStore) return
        const tab=this.activeTab
        await this.projectStore.remove(this.projectContext(base), project)
        if(tab!==this.activeTab)return
        this.loadProjects(base)
        this.render()
    }
    async launchProject (project: ArwProject, event?: Event): Promise<void> {
        event?.stopPropagation()
        const workspace = this.savedWorkspace(project)
        if (!workspace) return
        const tab=this.activeTab
        if (workspace.kind === 'remote' && this.projectStore && !this.terminalMode) {
            try { await this.projectStore.open(project,workspace,this.selection?.remote,this.selection?.sourceTerminal??this.selection?.terminal) }
            catch (error) { if(tab===this.activeTab){this.error=t`工作区转发开启失败：${String(error)}`;this.render()}return }
            if (!this.projectStore.connection(project.id)) return
        }
        if(tab!==this.activeTab)return
        await this.ai.launchConfigured({ ...(this.selection as WorkspaceSelection), workspace,terminalMode:this.terminalMode })
    }
    get visibleNodes (): TreeNode[] {
        const query=this.filterText.trim().toLocaleLowerCase()
        if(!query)return this.nodes
        const matches=new Set<number>()
        this.nodes.forEach((node,index)=>{
            if(!node.path.toLocaleLowerCase().includes(query))return
            matches.add(index)
            let depth=node.depth
            for(let parent=index-1;parent>=0&&depth>0;parent--){if(this.nodes[parent].depth<depth){matches.add(parent);depth=this.nodes[parent].depth}}
        })
        return this.nodes.filter((_,index)=>matches.has(index))
    }
    get changeCount (): number { return this.gitGroups.reduce((sum,group)=>sum+group.changes.length,0) }
    filteredChanges(changes:GitChange[]):GitChange[]{const query=this.filterText.trim().toLocaleLowerCase();return query?changes.filter(change=>change.path.toLocaleLowerCase().includes(query)):changes}
    async toggleTerminalMode (): Promise<void> {
        if (!this.isRemote) return
        const terminal=this.source
        if(!terminal)return
        if(!this.terminalMode){
            if(!terminal.session?.open||terminal.alternateScreenActive){this.error=t('请回到 shell 命令提示符后重试。');this.render();return}
            this.cwdSetupError=''
            await this.followTerminal()
            if(this.source!==terminal||this.error||this.cwdSetupError||this.cwdSetupPending)return
        }
        this.terminalMode=!this.terminalMode
        setTerminalCommandMode(terminal,this.terminalMode)
        this.projectsExpanded=true
        this.loadProjects(this.selection?.workspace)
        this.rememberBrowsing();this.render()
    }
    private rememberIfTabbed ():void{
        this.saveActiveState(false)
    }
    private rememberBrowsing():void{
        this.saveActiveState()
    }
    async followTerminal (): Promise<void> {
        const terminal=this.source,version=this.version,key=this.browsingKey(this.selection)
        if(!terminal)return
        try{
            const root=await terminal.session?.getWorkingDirectory()
            if(this.source!==terminal||version!==this.version||this.browsingKey(this.selection)!==key)return
            if(!root){
                if(this.canEnableCwd)await this.enableCwd()
                else {this.error=t('尚未收到终端 pwd，请在 shell 中启用路径检测后重试。');this.render()}
                return
            }
            const remote=isSshTab(terminal)?terminal.sshSession??undefined:undefined
            const workspace=remote?remoteWorkspace(remote,root):localWorkspace(root)
            this.selection={terminal,remote,workspace,pathSource:'terminal',hint:''}
            await this.showWorkspace(workspace)
        }catch(error){if(version===this.version&&this.browsingKey(this.selection)===key){this.error=String(error);this.render()}}
    }
    commitMessage (repository:GitRepositoryView): string { return this.commitMessages.get(repository.root) ?? '' }
    setCommitMessage (repository:GitRepositoryView, value:string): void {
        this.commitMessages.set(repository.root,value)
        this.rememberIfTabbed()
    }
    private git (repository:GitRepositoryView): RemoteGit { return workspaceGit(repository.workspace) }
    private async gitOperation (repository:GitRepositoryView, operation:()=>Promise<void>, message?:string, quiet=false): Promise<void> {
        if(repository.busy)return
        const version=this.version
        repository.busy=true;if(!quiet){repository.error='';repository.message=undefined;this.gitNoticeByRoot.delete(repository.root)}this.render()
        try { await operation(); if(message&&!quiet){repository.message=message;if(version===this.version&&this.repositories.includes(repository))this.gitNoticeByRoot.set(repository.root,{error:'',message})} }
        catch(error){logOperation(message??'Git 操作',{root:repository.root,background:quiet,error:String(error)});if(!quiet){repository.error=String(error);if(version===this.version&&this.repositories.includes(repository))this.gitNoticeByRoot.set(repository.root,{error:repository.error});this.render()}}
        finally{
            if(version===this.version&&this.repositories.includes(repository)){
                try{
                    const changes=await this.git(repository).status()
                    if(version===this.version&&this.repositories.includes(repository))this.applyGitChanges(repository,changes)
                }catch(error){if(!quiet)repository.error=String(error)}
            }
            repository.busy=false;this.render()
        }
    }
    async stageChange (change:GitChange, repository:GitRepositoryView): Promise<void> {
        await this.gitOperation(repository,()=>this.git(repository).stage([change]))
    }
    async unstageChange (change:GitChange, repository:GitRepositoryView): Promise<void> {
        await this.gitOperation(repository,()=>this.git(repository).unstage([change]))
    }
    async stageAll (repository:GitRepositoryView): Promise<void> {
        const changes=repository.groups.find(group=>!group.staged)?.changes??[]
        if(!changes.length)return
        await this.gitOperation(repository,()=>this.git(repository).stage(changes))
    }
    async unstageAll (repository:GitRepositoryView): Promise<void> {
        const changes=repository.groups.find(group=>group.staged)?.changes??[]
        if(!changes.length)return
        await this.gitOperation(repository,()=>this.git(repository).unstage(changes))
    }
    async discardChanges (repository:GitRepositoryView, change?:GitChange): Promise<void> {
        if(repository.busy)return
        const changes=change?[change]:(repository.groups.find(group=>!group.staged)?.changes??[])
        if(!changes.length)return
        if(changes.some(isGitConflict)){repository.error=t('冲突文件需要先解决冲突，不能直接还原。');this.render();return}
        const version=this.version
        repository.busy=true;this.render()
        try{
            const untracked=changes.filter(entry=>entry.index==='?').length
            const confirmation=await this.platform.showMessageBox({type:'warning',
                message:change?t`还原“${change.path}”的未暂存更改？`:t`还原 ${changes.length} 个文件的未暂存更改？`,
                detail:t`已暂存内容会保留。${untracked?t`其中 ${untracked} 个未跟踪文件会被永久删除。`:''}此操作无法撤销。`,
                buttons:[t('取消'),t('还原更改')],defaultId:0,cancelId:0})
            if(confirmation.response!==1||version!==this.version||!this.repositories.includes(repository))return
            repository.busy=false
            await this.gitOperation(repository,()=>this.git(repository).discard(changes),t('已还原未暂存更改'))
        }catch(error){repository.error=String(error)}
        finally{repository.busy=false;this.render()}
    }
    async commit (repository:GitRepositoryView): Promise<void> {
        const message=this.commitMessage(repository)
        if(!message.trim()||repository.busy)return
        if(!(repository.groups.find(group=>group.staged)?.changes.length??0)){
            repository.error=t('请先暂存需要提交的更改。')
            this.gitNoticeByRoot.set(repository.root,{error:repository.error});this.render();return
        }
        await this.gitOperation(repository,async()=>{
            const git=this.git(repository)
            await git.commit(message)
            this.commitMessages.delete(repository.root)
            await this.loadGitInspector(repository)
        },t('已提交'))
    }
    fileIcon(node:TreeNode):string{
        if(node.directory)return 'file-icon folder-icon'
        const extension=node.name.split('.').pop()?.toLowerCase()
        if(['ts','tsx','js','jsx','py','rs','go','java','css','html','vue','sh'].includes(extension??''))return 'far fa-file-code file-icon code-icon'
        if(['json','yaml','yml','toml','ini','conf'].includes(extension??''))return 'fas fa-sliders-h file-icon config-icon'
        if(['png','jpg','jpeg','gif','svg','webp'].includes(extension??''))return 'far fa-file-image file-icon image-icon'
        return 'far fa-file-alt file-icon'
    }
    private get source () { return this.selection?.sourceTerminal ?? this.selection?.terminal }
    get canForward (): boolean { return Boolean(this.selection?.workspace?.kind === 'remote' && this.source && isSshTab(this.source)) }
    get forwarded (): boolean { return Boolean(this.canForward && this.forwarding.state(this.source as any, this.selection!.workspace!.root)) }
    get forwardingBusy (): boolean { return Boolean(this.canForward && this.forwarding.busy(this.source as any)) }
    private stopForwarding (): void { if (this.canForward) void this.forwarding.disable(this.source as any) }
    async refreshCurrentView ():Promise<void> {
        const request=++this.manualRefreshRequest
        this.manualRefreshing=true;this.render()
        try{
            const selection=this.selection,source=selection?.sourceTerminal??selection?.terminal
            if(selection?.workspace?.kind==='remote'&&selection.remote?.open&&this.projectStore){
                for(const project of this.projects){
                    if(!this.projectStore.hasAiUsers(project.id))continue
                    const workspace=this.savedWorkspace(project)
                    if(workspace)await this.projectStore.open(project,workspace,selection.remote,source)
                }
            }
            if(this.mode==='git')await this.gitStatus()
            else await this.refresh()
            const workspace=this.browserWorkspace??this.selection?.workspace
            if(workspace)await refreshOpenedWorkspaceFiles(this.app,workspace)
        }finally{
            if(request===this.manualRefreshRequest){this.manualRefreshing=false;this.render()}
        }
    }
    async refresh (background=false): Promise<void> {
        const workspace = this.browserWorkspace ?? this.selection?.workspace
        this.loadProjects(this.selection?.workspace)
        if(!this.browserWorkspace)await this.showWorkspace(workspace,background)
        else await this.refreshFiles({background})
    }
    private async refreshFiles (options:{preserveError?:boolean; background?:boolean}={}): Promise<void> {
        const workspace=this.browserWorkspace
        if(!workspace)return
        const version=this.version,request=++this.treeRequest,path=this.relativePath||'.'
        const active=()=>version===this.version&&request===this.treeRequest&&this.browserWorkspace===workspace&&(this.relativePath||'.')===path
        const previous=new Map(this.nodes.map(node=>[node.path,node]))
        const expansionState=this.nodes.map(node=>[node.path,!!node.expanded,!!node.loading])
        const requestError=this.error
        if(!options.background){this.loading=true;if(!options.preserveError)this.error='';this.directoryListings.clear();this.render()}
        const load=async(path:string,depth:number):Promise<TreeNode[]>=>{
            const entries=await workspace.list(path)
            if(!active())return []
            if(entries.length>2000&&!options.background)this.error=t('此目录超过 2000 项，仅显示前 2000 项')
            const nodes:TreeNode[]=entries.slice(0,0) as TreeNode[]
            for(const entry of entries.slice(0,2000)){
                const old=previous.get(entry.path),node:TreeNode={...entry,depth,expanded:entry.directory&&old?.expanded}
                nodes.push(node)
                if(node.expanded)nodes.push(...await load(node.path,depth+1))
                if(!active())return []
            }
            return nodes
        }
        try{
            const nodes=await load(path,0)
            const unchanged=!options.background||JSON.stringify(expansionState)===JSON.stringify(this.nodes.map(node=>[node.path,!!node.expanded,!!node.loading]))
            if(active()&&unchanged){
                const visible=(entries:TreeNode[])=>entries.map(node=>[node.name,node.path,node.directory,node.symlink,node.depth,!!node.expanded])
                if(!options.background||JSON.stringify(visible(this.nodes))!==JSON.stringify(visible(nodes))){
                    this.nodes=nodes;this.directoryListings.clear();this.rememberBrowsing();if(options.background)this.render()
                }
            }
        }
        catch(error){logOperation('读取工作区目录',{root:workspace.root,background:!!options.background,error:String(error)});if(active()&&!options.background)this.error=String(error)}
        finally{
            if(active()&&!options.background){this.loading=false;if(options.preserveError&&!this.nodes.length&&requestError)this.error=requestError;this.ensureGitScan()}
            if(!options.background)this.render()
        }
    }
    private currentDirectoryWorkspace (): Workspace|undefined {
        const workspace=this.browserWorkspace??this.selection?.workspace
        if(!workspace||!this.relativePath)return workspace
        return workspace.kind==='remote'&&this.selection?.remote ? remoteWorkspace(this.selection.remote,this.breadcrumb)
            : workspace.kind==='local' ? localWorkspace(this.breadcrumb) : undefined
    }
    private currentGitScope (): string {
        const workspace=this.browserWorkspace??this.selection?.workspace
        return `${workspace?.kind}:${workspace?.host}:${this.breadcrumb}`
    }
    private gitScopeBelongsHere (scope?:string): boolean {
        if(!scope)return false
        const prefix=`${this.selection?.workspace?.kind}:${this.selection?.workspace?.host}:`
        return scope.startsWith(prefix)
    }
    showGit ():void { this.setMode('git') }
    get gitEmptyMessage ():string {
        return this.gitLoading?t('正在后台扫描当前目录…'):(this.gitScanCompleted&&this.gitScope===this.currentGitScope()?t('未检测到 Git 项目'):t('后台扫描尚未完成，可点击“刷新 Git”重试'))
    }
    cancelGitScan ():void {
        if(!this.gitLoading)return
        this.gitScanCompleted=false
        this.gitVersion++
        this.gitAbort?.abort();this.gitAbort=undefined;this.gitLoading=false
        this.gitScope=this.gitGroups.length&&this.gitScopeBelongsHere(this.gitScope)?this.gitScope:this.currentGitScope()
        for(const repository of this.repositories){
            repository.loading=false;repository.inspectorPending=false
            repository.inspectorVersion=(repository.inspectorVersion??0)+1
        }
        this.gitNotice=t('扫描已取消，已发现的仓库已保留；切换目录或点击刷新可重新扫描。')
        this.render()
    }
    gitSetupMode:'init'|'clone'|null=null
    gitSetupName=''
    gitSetupEmail=''
    gitSetupUrl=''
    gitSetupDirectory=''
    gitSetupRoot=''
    gitSetupError=''
    gitSetupBusy=false
    gitSetupProgress=''
    private gitSetupController?:AbortController
    get canSetupGit ():boolean {
        return this.gitScanCompleted&&this.gitScope===this.currentGitScope()&&!this.gitLoading&&!this.error&&!this.gitNotice&&!this.repositories.length&&(this.currentDirectoryWorkspace()?.kind==='local'||this.canForward)
    }
    openGitSetup (mode:'init'|'clone'):void {
        if(!this.canSetupGit||this.gitSetupBusy)return
        this.gitSetupMode=mode;this.gitSetupRoot=this.breadcrumb;this.gitSetupError='';this.gitSetupProgress='';this.rememberIfTabbed();this.render()
    }
    closeGitSetup ():void {if(!this.gitSetupBusy){this.gitSetupMode=null;this.gitSetupError='';this.rememberIfTabbed();this.render()}}
    cancelGitSetup ():void {this.gitSetupController?.abort()}
    async submitGitSetup ():Promise<void> {
        if(this.gitSetupBusy||!this.gitSetupMode)return
        const workspace=this.currentDirectoryWorkspace(),remote=this.selection?.remote,tab=this.source
        if(!workspace||(workspace.kind==='remote'&&(!remote?.open||!tab||!isSshTab(tab)))||this.breadcrumb!==this.gitSetupRoot){this.gitSetupError=t('当前目录已变化，请重新打开表单');this.render();return}
        const version=this.version,tabKey=this.activeTab,scope=this.currentGitScope(),mode=this.gitSetupMode
        const controller=new AbortController();this.gitSetupController=controller
        let retained=false,closed:{unsubscribe():void}|undefined
        this.gitSetupBusy=true;this.gitSetupError='';this.gitSetupProgress=mode==='init'?t('正在初始化 Git…'):t('正在通过本地 Git 克隆…');this.rememberIfTabbed();this.render()
        try {
            const identity=validateGitIdentity({name:this.gitSetupName,email:this.gitSetupEmail,url:this.gitSetupUrl})
            if(workspace.kind==='remote'){remote!.ref();retained=true;closed=remote!.willDestroy$.subscribe(()=>controller.abort())}
            const root=workspace.kind==='local' ? await setupLocalGit(workspace,mode,{...identity,directory:this.gitSetupDirectory},{signal:controller.signal,
                report:message=>{if(tabKey===this.activeTab&&version===this.version){this.gitSetupProgress=message;this.render()}}})
                : mode==='init' ? await initializeRemoteGit(workspace,identity,controller.signal)
                : await this.tasks.clone(tab as SSHTabComponent,{id:workspace.id,root:workspace.root,host:workspace.host},{...identity,directory:cloneDirectory(identity.url,this.gitSetupDirectory)},controller.signal,
                    message=>{if(tabKey===this.activeTab&&version===this.version){this.gitSetupProgress=message;this.render()}})
            if(tabKey!==this.activeTab||version!==this.version||scope!==this.currentGitScope())return
            const backend=workspace.kind==='local'?localWorkspace(root):remoteWorkspace(remote!,root)
            const repository:GitRepositoryView={workspace:backend,root,name:workspacePath(backend.kind).basename(root)||root,expanded:true,groups:[],error:'',count:0,loading:true,
                branch:'',branches:[],commits:[],inspector:'',inspectorLoading:false,inspectorError:''}
            this.invalidateGitScanCache(backend)
            this.repositories=[repository];this.gitWorkspace=backend;this.gitScope=scope;this.gitScanCompleted=true
            this.gitSetupMode=null;this.gitNotice='';this.gitSetupProgress=''
            try {
                const changes=await workspaceGit(backend,controller.signal).status()
                if(tabKey!==this.activeTab||version!==this.version||scope!==this.currentGitScope())return
                this.applyGitChanges(repository,changes)
                await this.loadGitInspector(repository,controller.signal)
            }catch(error){repository.error=redactSensitiveText(String(error))}
            finally{repository.loading=false}
        }catch(error){
            if(tabKey===this.activeTab&&version===this.version)this.gitSetupError=controller.signal.aborted?t('操作已取消，请检查目标目录的实际状态后再重试。'):redactSensitiveText(error instanceof Error?error.message:String(error))
        }finally{
            closed?.unsubscribe();if(retained)remote!.unref()
            if(this.gitSetupController===controller)this.gitSetupController=undefined
            if(tabKey===this.activeTab&&version===this.version)this.gitSetupBusy=false
            this.render()
        }
    }
    private async showWorkspace (workspace?: Workspace,background=false): Promise<void> {
        this.closeDirectoryCandidates()
        this.directoryListings.clear()
        this.directoryDraft=null
        this.browserWorkspace=workspace
        this.gitAbort?.abort();this.gitLoading=false;this.gitScope=undefined;this.gitScanCompleted=false;this.gitNotice='';this.gitSetupMode=null;this.gitSetupError=''
        const version = ++this.version
        this.error = ''; this.nodes = []; this.relativePath = ''; this.gitGroups=[];this.repositories=[];this.gitNotice='';this.gitWorkspace=undefined;this.loading = Boolean(workspace)
        this.render()
        if (!workspace) return
        this.ensureGitScan()
        try {
            const files = await workspace.list('.')
            if (version !== this.version) return
            this.directoryListings.set(workspace.root,{expires:Date.now()+5000,files:Promise.resolve(files)})
            this.nodes = files.slice(0,2000).map(file => ({ ...file, depth:0 }))
            this.loadProjects(this.selection?.workspace);this.rememberBrowsing()
            if (files.length>2000) this.error = t('此目录超过 2000 项，仅显示前 2000 项')
        } catch (error) { logOperation('打开工作区目录',{root:workspace.root,background,error:String(error)});if (!background&&version===this.version) this.error = String(error) }
        finally { if (version===this.version) this.loading = false; this.render() }
    }
    private downloadingNodes=new WeakSet<TreeNode>()
    showNodeContextMenu (node:TreeNode, event:MouseEvent):void {
        event.preventDefault();event.stopPropagation()
        const workspace=this.browserWorkspace??this.selection?.workspace,remote=this.selection?.remote
        const items:Array<{label:string;enabled?:boolean;click:()=>void|Promise<void>}>=[{
            label:t('复制路径'),
            click:()=>{const path=workspace?workspacePath(workspace.kind).resolve(workspace.root,node.path):node.path;this.platform.setClipboard({text:path});this.notifications.info(t('路径已复制'))},
        }]
        if(workspace?.kind==='remote'&&remote)items.unshift({
            label:node.directory?t('下载目录到本地…'):t('下载到本地…'),
            enabled:remote.open&&!node.symlink&&!node.loading&&!this.downloadingNodes.has(node),
            click:async()=>{
                if(this.downloadingNodes.has(node))return
                this.downloadingNodes.add(node)
                try{await downloadSftpItem(remote,workspace,node.path,this.platform,this.notifications)}
                finally{this.downloadingNodes.delete(node)}
            },
        })
        this.platform.popupContextMenu(items,event)
    }
    async clickNode (node:TreeNode,event:MouseEvent):Promise<void> {
        if(node.symlink){this.error=t('符号链接不支持在文件浏览器中打开：')+node.path;this.render();return}
        if(node.directory){if(event.detail<2)await this.toggle(node)}
        else await this.open(node)
    }
    async open (node: TreeNode): Promise<void> {
        const workspace = this.browserWorkspace ?? this.selection?.workspace
        if (!workspace || (node.loading && !node.directory)) return
        if(node.symlink){this.error=t('符号链接不支持在文件浏览器中打开：')+node.path;this.render();return}
        if (!node.directory) {
            this.rememberBrowsing()
            const kind=previewKind(node.path)
            if(kind&&kind!=='markdown'){
                const paths=workspacePath(workspace.kind),parent=paths.dirname(node.path)
                const imagePaths=this.nodes.filter(entry=>!entry.directory&&previewKind(entry.path)==='image'&&paths.dirname(entry.path)===parent).map(entry=>entry.path)
                await openFilePane(this.app,{type:ArwPreviewComponent,inputs:{workspace,filePath:node.path,imagePaths}},this.source,this.config?.store.omw?.fileLayout,this.tabs)
            }else await openFilePane(this.app,{ type: ArwEditorComponent, inputs: { workspace, filePath:node.path } },this.source,this.config?.store.omw?.fileLayout,this.tabs)
            return
        }
        await this.enter(node)
    }
    private async enter (node: TreeNode): Promise<void> {
        const workspace = this.browserWorkspace ?? this.selection?.workspace
        if (!workspace || !node.directory) return
        const version = ++this.version
        node.loading = true
        this.render()
        try {
            const children = await workspace.list(node.path)
            if(version!==this.version || this.browserWorkspace!==workspace) return
            this.nodes = children.slice(0,2000).map(file=>({...file,depth:0}))
            this.relativePath = node.path
            this.loadProjects(this.selection?.workspace);this.rememberBrowsing()
            this.resetGitBrowser();this.gitNotice='';this.gitSetupMode=null;this.gitSetupError=''
            this.ensureGitScan()
            this.error = ''
            if(children.length>2000)this.error=t('此目录超过 2000 项，仅显示前 2000 项')
        } catch(error){ if(version===this.version)this.error=String(error) }
        finally{node.loading=false;if(version===this.version)this.loading=false;this.render()}
    }
    async toggle (node: TreeNode): Promise<void> {
        const workspace = this.browserWorkspace ?? this.selection?.workspace
        if (!workspace || !node.directory || node.loading) return
        const index = this.nodes.indexOf(node)
        if(index<0)return
        if (node.expanded) {
            let end=index+1; while(end<this.nodes.length && this.nodes[end].depth>node.depth) end++
            this.nodes.splice(index+1,end-index-1); node.expanded=false; this.rememberBrowsing();this.render();return
        }
        const version = this.version; node.loading = true; this.render()
        try {
            const children = await workspace.list(node.path)
            if(version!==this.version || this.browserWorkspace!==workspace || !this.nodes.includes(node)) return
            this.nodes.splice(this.nodes.indexOf(node)+1,0,...children.slice(0,2000).map(file=>({...file,depth:node.depth+1})))
            node.expanded=true
            this.rememberBrowsing()
            if(children.length>2000)this.error=t('子目录超过 2000 项，仅显示前 2000 项')
        } catch(error){ if(version===this.version)this.error=String(error) }
        finally{node.loading=false;this.render()}
    }
    get parentPath (): string {
        return parentWorkspacePath(this.relativePath,(this.browserWorkspace??this.selection?.workspace)?.kind??'local')
    }
    get breadcrumb (): string {
        const workspace=this.browserWorkspace??this.selection?.workspace,root=workspace?.root??''
        return this.relativePath?workspacePath(workspace?.kind??'local').join(root,this.relativePath):root
    }
    async up (): Promise<void> {
        const workspace = this.browserWorkspace ?? this.selection?.workspace
        if (!workspace || !this.relativePath) return
        const version = ++this.version
        this.loading = true
        this.render()
        try {
            const path = this.parentPath || '.'
            const files = await workspace.list(path)
            if (version !== this.version || this.browserWorkspace !== workspace) return
            this.nodes = files.slice(0,2000).map(file => ({ ...file, depth:0 }))
            this.error = ''
            this.relativePath = path === '.' ? '' : this.parentPath
            this.loadProjects(this.selection?.workspace);this.rememberBrowsing()
            this.resetGitBrowser();this.gitNotice='';this.gitSetupMode=null;this.gitSetupError=''
            this.ensureGitScan()
            if (files.length > 2000) this.error = t('此目录超过 2000 项，仅显示前 2000 项')
        } catch (error) { if (version === this.version) this.error = String(error) }
        finally { if (version === this.version) this.loading = false; this.render() }
    }
    private repositoryKey(root:string):string{return `${this.selection?.workspace?.kind}:${this.selection?.workspace?.host}:${root}`}
    private resetGitBrowser():void{
        this.gitNeedsScan=true;this.gitVersion++;this.gitScan=undefined
        this.gitAbort?.abort();this.gitAbort=undefined;this.gitScope=undefined;this.gitScanCompleted=false;this.gitLoading=false
        this.repositories=[];this.gitGroups=[]
    }
    toggleRepository(repository:GitRepositoryView):void{
        repository.expanded=!repository.expanded
        this.collapsed.set(this.repositoryKey(repository.root),!repository.expanded)
        this.rememberBrowsing()
    }
    trackRepository(_index:number,repository:GitRepositoryView):string{return `${repository.workspace.kind}:${repository.workspace.host}:${repository.root}`}
    trackChange(_index:number,change:GitChange):string{return change.path}
    trackGitGroup(_index:number,group:{staged:boolean}):boolean{return group.staged}
    showInspector (repository:GitRepositoryView, inspector:'history'|'branches'|''):void{
        repository.inspector=repository.inspector===inspector?'':inspector;this.rememberIfTabbed();this.render()
    }
    trackCommit (_index:number,commit:GitCommit):string{return commit.hash}
    trackBranch (_index:number,branch:GitBranch):string{return branch.name}
    commitDate (commit:GitCommit):string{
        const date=new Date(commit.date)
        return Number.isNaN(date.getTime())?commit.date:date.toLocaleDateString()
    }
    async openCommit (repository:GitRepositoryView, commit:GitCommit):Promise<void>{
        if(repository.inspectorLoading)return
        const tab=this.activeTab
        repository.inspectorLoading=true;repository.error='';this.render()
        try {
            const patch=await this.git(repository).showCommit(commit.hash)
            if(tab!==this.activeTab||!this.repositories.includes(repository))return
            await openFilePane(this.app,{type:ArwEditorComponent,inputs:{workspace:repository.workspace,filePath:`${commit.shortHash} ${commit.subject}`,readonly:true,diffPatch:patch,
                diffLabel:t('父提交 → 当前提交'),diffDescription:`${commit.hash}\n${commit.author} · ${commit.date}\n${commit.subject}`}},this.source,this.config?.store.omw?.fileLayout,this.tabs)
        } catch(error){if(tab===this.activeTab)repository.error=String(error)}
        finally{if(tab===this.activeTab){repository.inspectorLoading=false;this.render()}}
    }
    async switchBranch (repository:GitRepositoryView, branch:GitBranch):Promise<void>{
        if(repository.busy||branch.current)return
        const version=this.version,tab=this.activeTab
        repository.busy=true;this.render()
        try {
            if(await this.git(repository).workingChangeCount()) {
                const confirmation=await this.platform.showMessageBox({type:'warning',message:t`切换到分支 ${branch.name}？`,detail:t('未提交的改动会在可以保留时带到目标分支；如果目标分支会覆盖这些文件，Git 将拒绝切换。'),buttons:[t('取消'),t('切换')],defaultId:0,cancelId:0})
                if(tab!==this.activeTab||version!==this.version||!this.repositories.includes(repository))return
                if(confirmation.response!==1)return
            }
        } catch(error){if(tab===this.activeTab){repository.error=String(error);this.render()}return}
        finally{if(tab===this.activeTab){repository.busy=false;this.render()}}
        if(tab!==this.activeTab||version!==this.version||!this.repositories.includes(repository))return
        await this.gitOperation(repository,async()=>{
            await this.git(repository).switchBranch(branch.name)
            await this.loadGitInspector(repository)
        },t`已切换到 ${branch.name}`)
    }
    private async loadGitInspector (repository:GitRepositoryView, signal?:AbortSignal,quiet=false):Promise<void>{
        const git=workspaceGit(repository.workspace,signal,true)
        const version=(repository.inspectorVersion??0)+1
        repository.inspectorVersion=version;repository.inspectorPending=true;this.render()
        const [branches,commits,sync]=await Promise.allSettled([git.branches(signal),git.history(50,signal),readGitSyncState(git)])
        if(signal?.aborted||repository.inspectorVersion!==version||!this.repositories.includes(repository))return
        repository.inspectorPending=false
        if(branches.status==='fulfilled'){
            repository.branches=branches.value;repository.branch=branches.value.find(branch=>branch.current)?.name??t('游离 HEAD')
        }
        if(commits.status==='fulfilled')repository.commits=commits.value
        repository.syncState=sync.status==='fulfilled'?sync.value:undefined
        if(!quiet)repository.syncError=sync.status==='rejected'?redactSensitiveText(String(sync.reason)):undefined
        if(commits.status==='fulfilled'){
            try{
                const history=await readCommitSyncHistory(git,commits.value,repository.syncState,repository.pushedCommits,repository.pulledCommits)
                if(signal?.aborted||repository.inspectorVersion!==version||!this.repositories.includes(repository))return
                repository.commits=history
            }catch(error){
                if(signal?.aborted||repository.inspectorVersion!==version||!this.repositories.includes(repository))return
                repository.commits=commits.value.map(commit=>({...commit,syncStatus:'unknown'}))
                if(!quiet)repository.syncError=redactSensitiveText(String(error))
            }
        }
        if(!quiet)repository.inspectorError=[branches,commits].flatMap(result=>result.status==='rejected'?[String(result.reason)]:[]).join('\n')
        this.render()
    }
    private applyGitChanges(entry:GitRepositoryView,changes:GitChange[]):void{
        entry.groups=[{title:t('已暂存'),staged:true,changes:changes.filter(change=>change.index!==' '&&change.index!=='?')},
            {title:t('工作区'),staged:false,changes:changes.filter(change=>change.working!==' ')}]
        entry.count=entry.groups.reduce((sum,group)=>sum+group.changes.length,0)
        this.gitGroups=this.repositories.flatMap(repository=>repository.groups)
    }
    private gitCacheContext(workspace:Workspace):string {
        return `${workspace.kind}:${this.projectContext(workspace).host}`
    }
    private directoryContains(root:string,path:string,kind:Workspace['kind']):boolean {
        const child=kind==='remote'?posix.relative(root,path):relative(root,path)
        const separator=kind==='remote'?'/':sep
        return child!=='..'&&!child.startsWith(`..${separator}`)&&!(kind==='remote'?posix.isAbsolute(child):isAbsolute(child))
    }
    private reuseGitScan():boolean {
        const workspace=this.currentDirectoryWorkspace()
        if(!workspace)return false
        const context=this.gitCacheContext(workspace)
        const cached=[...this.gitScanCache.values()].filter(entry=>entry.context===context&&
            (entry.root===workspace.root||(entry.complete&&this.directoryContains(entry.root,workspace.root,workspace.kind))))
            .sort((left,right)=>right.root.length-left.root.length)[0]
        if(!cached)return false
        this.repositories=cached.repositories.filter(repository=>this.directoryContains(workspace.root,repository.root,workspace.kind))
        for(const repository of this.repositories)if(workspace.kind==='remote'&&this.selection?.remote)repository.workspace=remoteWorkspace(this.selection.remote,repository.root)
        this.gitGroups=this.repositories.flatMap(repository=>repository.groups)
        this.gitWorkspace=this.repositories[0]?.workspace
        this.gitScope=this.currentGitScope();this.gitScanCompleted=true;this.gitNeedsScan=false
        this.gitNotice=cached.notice;this.render()
        return true
    }
    private invalidateGitScanCache(workspace:Workspace):void {
        const context=this.gitCacheContext(workspace)
        for(const [key,entry] of this.gitScanCache)if(entry.context===context&&
            (this.directoryContains(entry.root,workspace.root,workspace.kind)||this.directoryContains(workspace.root,entry.root,workspace.kind)))this.gitScanCache.delete(key)
    }
    private ensureGitScan():void{
        if(!this.browserWorkspace||this.gitLoading)return
        if((this.gitNeedsScan||this.gitScope!==this.currentGitScope())&&!this.reuseGitScan())void this.gitStatus(true)
    }
    gitStatus (background=false):Promise<void>{
        if(this.gitLoading)return this.gitScan??Promise.resolve()
        const scan=this.scanGit(background)
        this.gitScan=scan
        return scan
    }
    private async scanGit (background=false): Promise<void> {
        if(this.gitSetupBusy||this.gitLoading||this.repositories.some(repository=>repository.busy))return
        const selection=this.selection,key=this.browsingKey(selection),workspace=this.currentDirectoryWorkspace(),scope=this.currentGitScope(),version=this.version,request=++this.gitVersion
        if(!workspace)return
        this.invalidateGitScanCache(workspace)
        this.gitAbort?.abort();const controller=new AbortController();this.gitAbort=controller
        const active=()=>version===this.version&&request===this.gitVersion&&!controller.signal.aborted&&scope===this.currentGitScope()&&this.browsingKey(this.selection)===key
        if(!this.gitScopeBelongsHere(this.gitScope)){this.repositories=[];this.gitGroups=[];this.gitScope=undefined;this.gitScanCompleted=false}
        const previous=this.gitScope===scope?new Map(this.repositories.map(repository=>[repository.root,repository])):new Map<string,GitRepositoryView>()
        if(this.gitScope!==scope){this.repositories=[];this.gitGroups=[]}
        this.gitScope=scope
        this.gitScanCompleted=false;this.gitLoading=true;this.error='';this.gitNotice='';this.render()
        const repositories:GitRepositoryView[]=[],jobs:Promise<void>[]=[]
        let running=0;const waiters:Array<()=>void>=[]
        const load=async(entry:GitRepositoryView)=>{
            if(running>=2)await new Promise<void>(resolve=>waiters.push(resolve));else running++
            try{
                if(!active())return
                const git=workspaceGit(entry.workspace,controller.signal,true)
                const changes=await git.status()
                if(changes.length>1000)throw new Error(t('Git 变更超过 1000 项，请进入具体项目后刷新。'))
                if(!active())return
                const notice=this.selection?.workspace ? this.gitNoticeByRoot.get(entry.root) : undefined
                if(notice){entry.error=notice.error;entry.message=notice.message}
                this.applyGitChanges(entry,changes);this.render()
                await this.loadGitInspector(entry,controller.signal,background)
            }catch(error){logOperation('读取 Git 仓库状态',{root:entry.root,background,error:String(error)});if(active()&&!background)entry.error=String(error)}
            finally{
                if(active()){entry.loading=false;this.gitGroups=repositories.flatMap(repository=>repository.groups);this.render()}
                const next=waiters.shift();if(next)next();else running--
            }
        }
        try {
            const discovery=await discoverGitRepositories(workspace,{maxDepth:2,maxDirectories:60,maxRepositories:10,maxDurationMs:3000,concurrency:2,scanNestedRepositories:false,signal:controller.signal,onRepository:root=>{
                if(!active())return
                const repository=workspace.kind==='remote' && selection?.remote ? remoteWorkspace(selection.remote,root) : localWorkspace(root)
                const entry:GitRepositoryView=previous.get(root)??{workspace:repository,name:workspacePath(repository.kind).basename(root)||root,root,
                    expanded:this.collapsed.has(this.repositoryKey(root))?!this.collapsed.get(this.repositoryKey(root)):root===workspace.root,groups:[],error:'',count:0,loading:true,
                    branch:'',branches:[],commits:[],inspector:'',inspectorLoading:false,inspectorError:''}
                entry.loading=true
                repositories.push(entry);repositories.sort((a,b)=>a.root.localeCompare(b.root))
                this.repositories=[...repositories,...[...previous.values()].filter(entry=>!repositories.includes(entry))];this.gitWorkspace=repositories[0]?.workspace;this.render()
                jobs.push(load(entry))
            }})
            if(!active())return
            if(repositories.length===1&&!this.collapsed.has(this.repositoryKey(repositories[0].root)))repositories[0].expanded=true
            await Promise.all(jobs)
            if(!active())return
            this.gitNeedsScan=false
            this.repositories=[...repositories];this.gitGroups=repositories.flatMap(repository=>repository.groups);this.gitScope=scope;this.gitScanCompleted=true
            this.gitNotice=[discovery.truncated?t('已限制扫描范围：最多 2 层、60 个目录、10 个仓库、5000 个条目（单目录 2000）。可进入项目目录查看其余仓库。'):'',
                discovery.skipped.length?t`部分目录无法读取或探测（${discovery.skipped.length} 项）`:''].filter(Boolean).join(' ')
            this.gitScanCache.set(scope,{root:workspace.root,context:this.gitCacheContext(workspace),repositories:[...repositories],complete:!discovery.truncated&&!discovery.skipped.length,notice:this.gitNotice})
            while(this.gitScanCache.size>24)this.gitScanCache.delete(this.gitScanCache.keys().next().value!)
        }catch(error){logOperation('扫描 Git 仓库',{root:workspace.root,background,error:String(error)});controller.abort();if(version===this.version&&request===this.gitVersion){if(!background)this.error=String(error);this.gitLoading=false;this.render()}}
        finally{
            if(active()){
                this.gitLoading=false;this.gitAbort=undefined
                for(const repository of this.repositories){repository.loading=false;repository.inspectorPending=false}
            }
            this.render()
        }
    }
    async openChange (change: GitChange, staged: boolean, repository?:GitRepositoryView): Promise<void> {
        const workspace=repository?.workspace??this.gitWorkspace
        if(!workspace)return
        const tab=this.activeTab
        try {
            const patch=change.index==='?'?addedFilePatch((await workspace.read(change.path)).content):await workspaceGit(workspace).diff(change,staged)
            if(tab!==this.activeTab)return
            await openFilePane(this.app,{type:ArwEditorComponent,inputs:{workspace,filePath:change.path,readonly:true,diffPatch:patch,diffStaged:staged}},this.source,this.config?.store.omw?.fileLayout,this.tabs)
        }catch(error){if(tab===this.activeTab){this.error=String(error);this.render()}}
    }
    async toggleForwarding (): Promise<void> {
        const selection=this.selection
        if(!this.canForward||!selection?.workspace)return
        await this.forwarding.toggle(this.source as any,selection.workspace.root,()=>this.selection?.workspace===selection.workspace)
        this.render()
    }
    copyCli (): void {if(this.canForward)this.forwarding.copy(this.source as any,this.selection!.workspace!.root)}
    gitSyncLabel(repository:GitRepositoryView):string{
        if(repository.inspectorPending)return t('正在读取同步状态…')
        return repository.syncState?syncStateLabel(repository.syncState):repository.syncError?t('同步状态读取失败'):t('尚未读取同步状态')
    }
    commitSyncLabel(commit:GitCommit):string{
        return {unpushed:t('待推送'),synced:t('已在上游'),incoming:t('待拉取'),pushed:t('已推送'),pulled:t('已拉取'),unknown:t('同步状态未知')}[commit.syncStatus??'unknown']
    }
    private async recordGitSync(repository:GitRepositoryView,direction:'pull'|'push',operation:()=>Promise<boolean|void>):Promise<void>{
        const git=this.git(repository)
        const before=(await git.probe(['rev-parse','--verify','--quiet','HEAD']))?.trim()
        const state=await readGitSyncState(git).catch(()=>undefined)
        const outgoing=state?.kind==='tracked'&&state.head&&state.upstreamOid
            ? (await git.run(['rev-list',state.head,'--not',state.upstreamOid,'--']).catch(()=>'')).trim().split('\n').filter(Boolean):[]
        if(await operation()===false)throw new Error(t('Git 中继未完成，请查看通知中的错误详情。'))
        if(direction==='push'){
            if((await git.probe(['rev-parse','--verify','--quiet','HEAD']))?.trim()!==before)return
            repository.pushedCommits??=new Set()
            for(const hash of outgoing)repository.pushedCommits.add(hash)
        }else if(before){
            const added=(await git.run(['rev-list','HEAD','--not',before,'--']).catch(()=>{
                repository.syncError=t('拉取已完成，但无法读取本次提交范围；请刷新提交记录。')
                return ''
            })).trim().split('\n').filter(Boolean)
            repository.pulledCommits??=new Set()
            for(const hash of added)repository.pulledCommits.add(hash)
        }
    }
    canSyncGit(repository:GitRepositoryView):boolean{
        return repository.workspace.kind==='local'||Boolean(this.canForward&&this.selection?.remote?.open)
    }
    async syncGit(action:LocalGitSyncAction,repository:GitRepositoryView,quiet=false):Promise<void>{
        if(!this.canSyncGit(repository)||!this.repositories.includes(repository)||repository.busy||repository.loading||this.gitLoading)return
        if(repository.workspace.kind==='local')await this.localSync(action,repository,quiet)
        else await this.relay(action,repository,quiet)
    }
    async localSync(action:LocalGitSyncAction,repository:GitRepositoryView,quiet=false):Promise<void>{
        if(repository.workspace.kind!=='local'||!this.repositories.includes(repository)||repository.loading||this.gitLoading)return
        const labels={fetch:t('已提取上游状态'),pull:t('已快进拉取'),push:t('已推送到上游分支')}
        await this.gitOperation(repository,async()=>{
            const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),600_000)
            if(!quiet)repository.relayProgress={fetch:t('正在提取上游状态…'),pull:t('正在拉取上游更新…'),push:t('正在推送到上游…')}[action]
            repository.relayCancel=()=>controller.abort();this.render()
            try{
                const operation=()=>syncLocalGit(repository.workspace.root,action,controller.signal)
                if(action==='fetch')await operation()
                else await this.recordGitSync(repository,action,operation)
            }
            catch(error){throw new Error(redactSensitiveText(String(error instanceof Error?error.message:error)))}
            finally{clearTimeout(timeout);repository.relayProgress=undefined;repository.relayCancel=undefined;await this.loadGitInspector(repository,undefined,quiet)}
        },labels[action],quiet)
    }
    async relay (direction:'fetch'|'pull'|'push',repository?:GitRepositoryView,quiet=false):Promise<void>{
        if(!this.canForward||!this.selection?.workspace)return
        const entry=repository??this.repositories.find(entry=>entry.root===this.breadcrumb)
        if(!entry||entry.workspace.kind!=='remote'||entry.loading||this.gitLoading)return
        const source=this.source as any
        await this.gitOperation(entry,async()=>{
            const w=entry.workspace
            if(!quiet)entry.relayProgress=t('正在检查仓库与上游配置…');this.render()
            try{
                const operation=()=>{
                    entry.relayCancel=()=>this.tasks.cancel(source)
                    return this.tasks.run(source,{id:w.id,root:w.root,host:w.host},direction,{
                        throwOnError:true,quiet,
                        report:message=>{if(!quiet){entry.relayProgress=redactSensitiveText(message);this.render()}},
                    })
                }
                if(direction==='fetch'){
                    if(!await operation())throw new Error(t('Git 中继未完成，请查看通知中的错误详情。'))
                }else await this.recordGitSync(entry,direction,operation)
            }finally{entry.relayProgress=undefined;entry.relayCancel=undefined;this.render()}
        },direction==='fetch'?t('已提取上游状态'):direction==='push'?t('已推送到上游分支'):t('已快进拉取'),quiet)
        if(this.repositories.includes(entry)&&!entry.error)await this.loadGitInspector(entry,undefined,quiet)
    }
    cancelRelay(repository:GitRepositoryView):void{repository.relayCancel?.()}
    get isRemote():boolean{return this.selection?.workspace?.kind==='remote'||Boolean(this.selection?.remote)}
    get workspaceLabel():string{
        if(this.selection?.workspace)return this.selection.workspace.label
        const remote=this.selection?.remote
        return remote?`${remote.authUsername??remote.profile.options.user??''}@${remote.profile.options.host}`:t('未选择目录')
    }
    get connectionLabel():string{
        if(this.selection?.workspace)return this.isRemote?t('SSH 远程工作区'):t('本地工作区')
        return this.selection?.remote?.open?t('SSH 已连接 · 等待路径'):this.selection?t('正在检测目录'):t('等待终端')
    }
    get canEnableCwd():boolean{return Boolean(!this.selection?.sourceTerminal&&this.source&&isSshTab(this.source)&&this.source.sshSession?.open&&this.source.session?.open)}
    async enableCwd():Promise<void>{
        if(!this.canEnableCwd||this.cwdSetupPending)return
        const terminal=this.source!
        if(terminal.alternateScreenActive){this.cwdSetupError=t('请先退出全屏程序，回到 shell 命令提示符。');return}
        this.clearCwdSetup();const version=this.cwdSetupVersion
        this.cwdSetupError='';this.cwdSetupPending=true;this.render()
        try{
            const prepared=await this.registry.prepareCwdIntegration(terminal,this.cwdShell)
            if(version!==this.cwdSetupVersion||this.source!==terminal||!this.cwdSetupPending){await prepared.cleanup();return}
            this.cwdSetupCleanup=prepared.cleanup
            if(terminal.alternateScreenActive)throw new Error(t('请回到 shell 命令提示符后重试。'))
            this.cwdSetupTimer=setTimeout(()=>{
                this.cwdSetupPending=false;this.clearCwdSetup()
                if(!this.selection?.workspace||this.selection.pathSource==='sftp')this.cwdSetupError=t('未收到目录，请确认所选 shell 正确，并在命令提示符下重试。也可以复制命令手动执行。');this.render()
            },8000)
            terminal.sendInput(` ${prepared.command}\r`)
        }catch(error){
            if(version!==this.cwdSetupVersion)return
            this.cwdSetupPending=false;this.cwdSetupError=String(error);this.clearCwdSetup();this.render()
        }
    }
    copyCwdHook():void{
        this.platform.setClipboard({text:cwdIntegrationCommand(this.cwdShell)})
        this.notifications.info(t`已复制 ${this.cwdShell} 会话级路径检测命令，不修改远端配置文件。`)
    }
    private watchController?:AbortController
    private snapshotController?:AbortController
    private watchTab?:object
    private watchedWorkspace?:Workspace
    private watchNotice=''
    private snapshotNotice=''
    private snapshotInputs:string[]=[]
    private gitChangedByWatch=false
    private gitWatchLastRefresh=0
    private workspaceChangeTimer?:ReturnType<typeof setTimeout>
    private workspaceChangePending=false
    private workspaceChangeBusy=false
    private sameWorkspace(a?:Workspace,b?:Workspace):boolean{
        return Boolean(a&&b&&a.kind===b.kind&&a.root===b.root&&a.host===b.host)
    }
    private watchWorkspace():void{
        const workspace=this.browserWorkspace??this.selection?.workspace,tab=this.activeTab
        if((this.watchController||this.snapshotController)&&this.watchTab===tab&&this.sameWorkspace(this.watchedWorkspace,workspace))return
        this.watchController?.abort();this.watchController=undefined;this.snapshotController?.abort();this.snapshotController=undefined
        this.watchedWorkspace=undefined;this.watchTab=tab;this.watchNotice='';this.snapshotNotice='';this.snapshotInputs=[]
        if(!workspace)return
        this.watchedWorkspace=workspace
        if(workspace.watch){
            const controller=new AbortController();this.watchController=controller
            void workspace.watch(()=>{this.gitChangedByWatch=true;this.workspaceChanged(workspace)},error=>this.watchFailed(workspace,error),controller.signal,()=>[...this.snapshotDirectories(),...(this.mode==='git'?this.repositories.map(repository=>workspace.kind==='local'?resolve(repository.root,'.git'):posix.join(repository.root,'.git')):[])])
                .catch(error=>{if(!controller.signal.aborted)this.watchFailed(workspace,error)})
        }else if(workspace.watchSnapshot){
            this.startSnapshotWatch(workspace)
        }
    }
    private watchFailed(workspace:Workspace,error:unknown):void{
        if(this.watchController?.signal.aborted||workspace!==this.watchedWorkspace||workspace!==(this.browserWorkspace??this.selection?.workspace))return
        logOperation('监视工作区目录',{root:workspace.root,error:String(error)})
        this.watchController?.abort();this.watchController=undefined
        this.render()
    }
    private startSnapshotWatch(workspace:Workspace):void{
        if(!workspace.watchSnapshot)return
        const controller=new AbortController();this.snapshotController=controller
        void workspace.watchSnapshot(()=>this.snapshotDirectories(),inputs=>{
            this.snapshotInputs=inputs??[]
            this.gitChangedByWatch=true
            this.workspaceChanged(workspace)
        },controller.signal)
            .catch(error=>logOperation('监视远程目录快照',{root:workspace.root,error:String(error)}))
    }
    private snapshotDirectories():string[]{
        const directories=[this.relativePath||'.']
        for(const node of this.nodes)if(node.directory&&node.expanded)directories.push(node.path)
        if(this.mode==='git')for(const repository of this.repositories)if(repository.expanded)directories.push(repository.root)
        return [...new Set(directories)].slice(0,32)
    }
    private workspaceChanged(workspace:Workspace):void{
        if(!this.sameWorkspace(workspace,this.browserWorkspace??this.selection?.workspace))return
        this.workspaceChangePending=true
        if(this.workspaceChangeTimer)clearTimeout(this.workspaceChangeTimer)
        const delay=this.mode==='git'?Math.max(80,5000-(Date.now()-this.gitWatchLastRefresh)):80
        this.workspaceChangeTimer=setTimeout(()=>{this.workspaceChangeTimer=undefined;void this.flushWorkspaceChanges()},delay)
    }
    private async flushWorkspaceChanges():Promise<void>{
        if(this.workspaceChangeBusy||!this.workspaceChangePending||this.uploadBusy)return
        this.workspaceChangeBusy=true;this.workspaceChangePending=false
        const version=this.version,tab=this.activeTab
        const workspace=this.browserWorkspace??this.selection?.workspace
        this.snapshotInputs=[]
        try{
            if(this.mode==='files')await this.refreshFiles({preserveError:true,background:true})
            else if(this.mode==='git'&&!this.gitLoading&&this.gitChangedByWatch)await this.refreshWatchedGit()
        }finally{
            if(workspace)await refreshOpenedWorkspaceFiles(this.app,workspace)
            this.workspaceChangeBusy=false
            if(version===this.version&&tab===this.activeTab&&this.workspaceChangePending)this.workspaceChanged(this.browserWorkspace??this.selection!.workspace!)
        }
    }
    get watchUnavailable():string{return this.watchNotice}
    get snapshotUnavailable():string{return this.snapshotNotice}
    private async refreshWatchedGit():Promise<void>{
        const version=this.version,tab=this.activeTab,scope=this.gitScope
        const active=()=>version===this.version&&tab===this.activeTab&&scope===this.gitScope&&!this.gitLoading
        if(Date.now()-this.gitWatchLastRefresh<5000){this.workspaceChangePending=true;return}
        this.gitWatchLastRefresh=Date.now()
        this.gitChangedByWatch=false
        for(const repository of this.repositories){
            if(!active())return
            try{
                if(repository.busy||repository.loading)continue
                const content=await readBackgroundGit(repository.workspace,['status','--porcelain=v1','-z','--untracked-files=all'])
                if(content.truncated)throw new Error(t('Git 变更过多，已停止自动更新，请进入具体项目后刷新。'))
                if(!active())return
                if(content.exitCode===0&&content.stdout!==repository.watchedStatus){
                    const changes=parseGitStatus(content.stdout)
                    if(changes.length>1000)throw new Error(t('Git 变更超过 1000 项，请进入具体项目后刷新。'))
                    if(!active())return
                    repository.watchedStatus=content.stdout
                    this.applyGitChanges(repository,changes)
                }
            }catch(error){logOperation('自动刷新 Git 状态',{root:repository.root,error:String(error)})}
        }
        if(active())this.render()
    }
    ngAfterViewInit():void{this.viewReady=true;this.watchWorkspace()}
    private disposeWorkspaceWatch():void{clearTimeout(this.workspaceChangeTimer);this.watchController?.abort();this.snapshotController?.abort();this.snapshotController=undefined;this.watchController=undefined;this.watchedWorkspace=undefined;this.snapshotInputs=[]}
    ngOnDestroy():void{this.disposeWorkspaceWatch();this.cancelUpload();this.gitSetupController?.abort();this.viewReady=false;this.unsubscribeActivity();this.gitAbort?.abort();this.clearCwdSetup();this.subscription.unsubscribe();this.stopForwarding()}
}
