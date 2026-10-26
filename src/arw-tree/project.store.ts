import { cliWorkspaceFiles } from '../arw-cli/workspace-files'
import { gitRelayOperation } from '../adapters/git-relay-operation'
import { activityScope } from '../arw-cli/agent-activity'
import { isTerminalCommandMode, runTerminalCommand } from '../shared/terminal-command'
import type { BaseTerminalTabComponent } from 'tabby-terminal'
import { t } from '../shared/i18n'
import { sftpCopy } from '../adapters/sftp-copy'
import { RemotePathGuard } from '../security/remote-path'
import { Subject } from 'rxjs'
import { redactSensitiveText } from '../shared/redact'
import { ConfigService } from 'tabby-core'
import { Workspace } from './workspace'
import { SavedWorkspace, writeWorkspaceCatalog, workspaceCatalogPath } from '../arw-cli/workspace-catalog'
import { ForwardingServer } from '../arw-cli/forwarding-server'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { localWorkspace } from './workspace'
import type { SSHSession } from '../adapters/ssh-compat'
import { leafName, workspaceNames } from '../shared/workspace-name'

export interface ArwProject { id:string; name:string; root:string }

export interface ProjectForwardingState {phase:'saved'|'starting'|'forwarding'|'error';logs:readonly string[]}

type Store = { projects?: Record<string,ArwProject[]> }
interface ProjectForwarding {
    server: ForwardingServer
    remote?: SSHSession
    client?: SSHSession['ssh']
    source?: object
    directory?: string
    configPath?: string
    retained: boolean
    closed?: { unsubscribe():void }
    ready: Promise<void>
    cleanup?: Promise<void>
}

/** Persists user-added projects per workspace in Tabby's config store. */
export class ProjectStore {
    readonly changed = new Subject<void>()
    private states = new Map<string,ProjectForwardingState>()
    state(id:string):ProjectForwardingState {return this.states.get(id)??{phase:'saved',logs:[]}}
    private setState(id:string,phase:ProjectForwardingState['phase'],operation?:string,error?:unknown):void {
        const previous=this.state(id)
        let logs=[...previous.logs]
        if(error!==undefined){
            const detail=typeof (error as {stack?:unknown})?.stack==='string'?(error as {stack:string}).stack:String(error)
            let safe=redactSensitiveText(detail)
            try{const token=this.forwards.get(id)?.server.connection.token;if(token)safe=safe.replaceAll(token,'<hidden>')}catch{}
            logs=[...logs,t`${new Date().toLocaleString()} · ${operation??t('转发')}\n${safe.slice(0,8000)}`].slice(-5)
        }
        if(previous.phase===phase&&error===undefined)return
        this.states.set(id,{phase,logs});this.changed.next()
    }
    private disposed = false
    private catalogWrite: Promise<void> = Promise.resolve()
    private forwards = new Map<string,ProjectForwarding>()
    constructor (private config: ConfigService, private catalogFile?: string) {}
    connection (id: string, source?: object): string|undefined {
        const entry=this.forwards.get(id)
        return entry && (!source || entry.source === source) && (!entry.remote || entry.remote.open) ? entry.configPath : undefined
    }
    private cleanup (entry: ProjectForwarding): Promise<void> {
        return entry.cleanup ??= (async()=>{
            entry.closed?.unsubscribe()
            try { await entry.server.stop() }
            finally {
                try { if (entry.directory) await rm(entry.directory,{recursive:true,force:true}) }
                finally { if (entry.retained) { entry.retained=false;entry.remote?.unref() } }
            }
        })()
    }
    async open (project: ArwProject, workspace: Workspace, remote?: SSHSession, source?: object): Promise<void> {
        if (this.disposed || !Object.values(this.store.projects ?? {}).some(projects=>Array.isArray(projects)&&projects.some(entry=>entry.id===project.id))) return
        if (workspace.kind === 'local') { await this.close(project.id); return }
        const current=this.forwards.get(project.id)
        const ownerCurrent=!current?.source||!('sshSession' in current.source)||current.source.sshSession===current.remote
        if (current && (remote
            ? current.remote?.open && current.client===current.remote.ssh && ownerCurrent
                && (current.remote===remote || Boolean(source&&current.source&&source!==current.source))
            : !current.remote)) return current.ready
        if (current) await this.close(project.id)
        if(this.disposed||!Object.values(this.store.projects??{}).some(projects=>Array.isArray(projects)&&projects.some(entry=>entry.id===project.id)))return
        if (workspace.kind==='remote' && !remote?.open) {
            const error=new Error(t('SSH 会话已断开'));this.setState(project.id,'error',t('启动转发'),error);throw error
        }
        this.setState(project.id,'starting')
        const cliFiles=cliWorkspaceFiles(workspace)
        const entry:ProjectForwarding={remote,client:remote?.ssh,source,retained:false,ready:Promise.resolve(),server:new ForwardingServer({
            activityScope:remote&&source?activityScope(source):undefined,
            workspace:{id:project.id,root:workspace.root,host:workspace.host},
            terminalOnly:()=>Boolean(source&&isTerminalCommandMode(source)),
            onRequestFinished:(operation,error)=>{
                if(this.forwards.get(project.id)!==entry||this.disposed)return
                this.setState(project.id,error===undefined?'forwarding':'error',operation,error)
            },
            git: remote?gitRelayOperation(remote,workspace.root,join(dirname(this.catalogFile??workspaceCatalogPath()),'git-relay')):undefined,
            copy: remote ? sftpCopy(() => remote.openSFTP(), new RemotePathGuard(workspace.root, (command, signal) => workspace.run(command, signal))) : undefined,
            list:async(path,signal)=>{signal.throwIfAborted();return {entries:await cliFiles.list(path)}},
            read:async(path,signal)=>{signal.throwIfAborted();return {path,...await cliFiles.read(path)}},
            write:async(path,content,signal,expectedHash)=>{signal.throwIfAborted();return {path,...await cliFiles.write(path,content,expectedHash)}},
            run:(command,signal,options)=>source&&isTerminalCommandMode(source)?runTerminalCommand(source as BaseTerminalTabComponent<any>,workspace.root,command,signal,options?.maxBytes):workspace.run(command,signal,options),
            validateCommand:workspace.validateCommand?.bind(workspace),
        }, this.catalogFile ? join(dirname(this.catalogFile), 'audit.jsonl') : undefined)}
        this.forwards.set(project.id,entry)
        entry.ready=(async()=>{
            try {
                if (remote) {
                    remote.ref();entry.retained=true
                    entry.closed=remote.willDestroy$.subscribe(()=>{if(this.forwards.get(project.id)===entry)void this.close(project.id,new Error(t('来源 SSH 连接已断开'))).catch(()=>undefined)})
                }
                await entry.server.start()
                entry.directory=await mkdtemp(join(tmpdir(),'arw-project-'))
                const configPath=join(entry.directory,'connection.json')
                await writeFile(configPath,JSON.stringify(entry.server.connection),{mode:0o600,flag:'wx'})
                if (this.forwards.get(project.id)!==entry || (remote && !remote.open)) {
                    if (this.forwards.get(project.id)===entry) this.forwards.delete(project.id)
                    await this.cleanup(entry);await this.syncCatalog();return
                }
                entry.configPath=configPath
                await this.syncCatalog()
                if(this.forwards.get(project.id)===entry)this.setState(project.id,'forwarding')
            } catch (error) {
                const active=this.forwards.get(project.id)===entry
                if (active) {this.setState(project.id,'error',t('启动转发'),error);this.forwards.delete(project.id)}
                await this.cleanup(entry)
                await this.syncCatalog()
                if (active) throw error
            }
        })()
        return entry.ready
    }
    async close (id: string, error?:unknown): Promise<void> {
        const entry=this.forwards.get(id)
        if (!entry) return
        this.forwards.delete(id)
        this.setState(id,error===undefined?'saved':'error',t('连接关闭'),error)
        await entry.ready.catch(()=>undefined)
        await this.cleanup(entry)
        await this.syncCatalog()
    }
    async restoreLocal (): Promise<void> {
        for (const [key,projects] of Object.entries(this.store.projects ?? {})) {
            if (!key.startsWith('local:') || !Array.isArray(projects)) continue
            for (const project of projects) await this.open(project,localWorkspace(project.root))
        }
        await this.syncCatalog()
    }
    async ngOnDestroy (): Promise<void> {
        this.disposed=true
        await Promise.all([...this.forwards.keys()].map(id=>this.close(id)))
    }
    syncCatalog (): Promise<void> {
        if (!this.catalogFile) return Promise.resolve()
        const file=this.catalogFile
        this.catalogWrite=this.catalogWrite.catch(()=>undefined).then(async()=>{
            const workspaces: SavedWorkspace[]=[]
            for (const [key,projects] of Object.entries(this.store.projects ?? {})) {
                if (!Array.isArray(projects)) continue
                const separator=key.indexOf(':'),kind=key.slice(0,separator),identity=key.slice(separator+1)
                if (kind!=='remote') continue
                let host=identity,port:number|undefined,user:string|undefined
                if (kind==='remote' && identity.startsWith('[')) {
                    try { [host,port,user]=JSON.parse(identity) } catch { continue }
                }
                const names=workspaceNames(projects.map(project=>({kind:'remote',root:project.root})),false)
                for (const [index,project] of projects.entries()) {
                    const configPath=this.connection(project.id)
                    workspaces.push({workspaceId:project.id,workspaceRoot:project.root,name:names[index],
                        host,...(port===undefined?{}:{port}),...(user===undefined?{}:{user}),
                        status:configPath?'forwarded':'saved',...(configPath?{configPath}:{})})
                }
            }
            await writeWorkspaceCatalog(file,workspaces)
        })
        return this.catalogWrite
    }
    private get store (): Store { return this.config.store.omw ??= {} }
    private key (workspace: Workspace): string {
        return `${workspace.kind}:${workspace.host}`
    }
    list (workspace: Workspace): ArwProject[] {
        const projects = this.store.projects?.[this.key(workspace)]
        return Array.isArray(projects) ? projects : []
    }
    async add (workspace: Workspace, root: string): Promise<ArwProject|undefined> {
        const projects = this.store.projects ?? {}
        const key = this.key(workspace)
        const current = Array.isArray(projects[key]) ? projects[key] : []
        if (current.some(project => project.root === root)) return undefined
        const project = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`, root,
            name: leafName(root) }
        this.store.projects = { ...projects, [key]: [...current, project] }
        await this.config.save()
        await this.syncCatalog()
        return project
    }
    async remove (workspace: Workspace, project: ArwProject): Promise<void> {
        const projects = this.store.projects
        if (!projects) return
        const key = this.key(workspace)
        this.store.projects = { ...projects, [key]: (projects[key] ?? []).filter(entry => entry.id !== project.id) }
        await this.close(project.id)
        this.states.delete(project.id);this.changed.next()
        await this.config.save()
        await this.syncCatalog()
    }
}
