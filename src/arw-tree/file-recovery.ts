import type { AppService } from 'tabby-core'
import { posix, isAbsolute, resolve as resolvePath } from 'node:path'
import { t } from '../shared/i18n'
import { localWorkspace, type Workspace } from './workspace'
import { isSshTab } from '../adapters/ssh-compat'
import { remoteWorkspace, remoteWorkspaceSession } from '../adapters/remote-workspace'
import type { FileSessionPool } from '../services/file-session-pool'
import { logFileRecovery } from '../services/file-recovery-log'

export interface FileWorkspaceToken {
    kind:'local'|'remote'
    root:string
    host:string
    port?:number
    user?:string
    profileId?:string
}
interface RestoredFileWorkspace {
    token:FileWorkspaceToken
    resolve:(signal?:AbortSignal)=>Promise<Workspace>
}
const restored=new WeakMap<Workspace,RestoredFileWorkspace>()

function recoveryTabs(app:AppService,token:FileWorkspaceToken):unknown[] {
    return (app.tabs??[]).map(top=>({type:top.constructor?.name,children:('getAllTabs' in top?(top as any).getAllTabs():[top]).map((tab:any)=>{
        const ssh=isSshTab(tab),session=tab.sshSession,profile=session?.profile??tab.profile
        const options=profile?.options,user=session?.authUsername??options?.user
        const rejected=[]
        if(!ssh)rejected.push('not-ssh-instance')
        if(!session)rejected.push('no-session')
        else if(!session.open)rejected.push('session-not-open')
        if(options?.host!==token.host)rejected.push('host-mismatch')
        if((options?.port??22)!==(token.port??22))rejected.push('port-mismatch')
        if(token.profileId&&profile?.id!==token.profileId)rejected.push('profile-mismatch')
        if(user!==token.user)rejected.push('user-mismatch')
        return {type:tab.constructor?.name,ssh,frontendReady:tab.frontendIsReady,sessionPresent:!!session,open:session?.open,
            profileId:profile?.id,host:options?.host,port:options?.port,user,rejected}
    })}))
}

const findRemoteSession=(app:AppService,token:FileWorkspaceToken) => {
    for(const top of app.tabs??[]){
        const tabs='getAllTabs' in top?(top as any).getAllTabs():[top]
        for(const tab of tabs){
            if(!isSshTab(tab))continue
            const session=tab.sshSession,profile=session?.profile
            if(!session?.open||!profile)continue
            if(profile.options.host!==token.host||(profile.options.port??22)!==(token.port??22))continue
            if(token.profileId&&profile.id!==token.profileId)continue
            if((session.authUsername??profile.options.user)!==token.user)continue
            return session
        }
    }
    return undefined
}

export function fileWorkspaceToken(workspace:Workspace):FileWorkspaceToken|undefined {
    const saved=restored.get(workspace)
    if(saved)return saved.token
    let root=workspace.root,source=workspace
    while(source.sourceWorkspace){
        source=source.sourceWorkspace
        if(workspace.kind==='local')root=isAbsolute(root)?root:resolvePath(source.root,root)
        else if(!posix.isAbsolute(root))root=posix.join(source.root,root)
    }
    if(workspace.kind==='local')return {kind:'local',root,host:'localhost'}
    const session=remoteWorkspaceSession(source)
    if(!session)return undefined
    return {kind:'remote',root,host:session.profile.options.host,port:session.profile.options.port??22,
        user:session.authUsername??session.profile.options.user,profileId:session.profile.id}
}

export function restoredFileWorkspace(token:FileWorkspaceToken,app:AppService,pool?:FileSessionPool):Workspace {
    if(token.kind==='local')return localWorkspace(token.root)
    const acquire=async(signal?:AbortSignal)=>{
        if(!pool)return undefined
        signal?.throwIfAborted()
        if(!signal)return pool.get(token)
        return new Promise<Awaited<ReturnType<FileSessionPool['get']>>>((resolve,reject)=>{
            const abort=()=>reject(signal.reason??new Error(t('操作已取消')))
            signal.addEventListener('abort',abort,{once:true})
            pool.get(token).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
        })
    }
    const resolve=async(signal?:AbortSignal):Promise<Workspace>=>{
        const started=Date.now()
        logFileRecovery('resolve-start',{token,pool:!!pool})
        let pending:Promise<void>|undefined
        let acquired:Awaited<ReturnType<FileSessionPool['get']>>
        let acquisitionError:unknown
        let wake:(()=>void)|undefined
        let lastSnapshot='',lastLogged=0
        try{
        while(true){
            signal?.throwIfAborted()
            const session=findRemoteSession(app,token)??acquired
            if(session){
                logFileRecovery('resolve-connected',{token,elapsedMs:Date.now()-started,source:session===acquired?'pool':'terminal'})
                return remoteWorkspace(session,token.root)
            }
            const tabs=recoveryTabs(app,token),snapshot=JSON.stringify(tabs)
            if(snapshot!==lastSnapshot||Date.now()-lastLogged>=5000){
                logFileRecovery('resolve-wait',{token,elapsedMs:Date.now()-started,pending:!!pending,tabs})
                lastSnapshot=snapshot;lastLogged=Date.now()
            }
            if(acquisitionError)throw acquisitionError
            if(!pending){
                pending=acquire(signal).then(session=>{acquired=session;if(session)wake?.()},error=>{acquisitionError=error;wake?.()})
                    .finally(()=>{pending=undefined})
            }
            // Wake as soon as authentication completes; polling is only for late terminal registration.
            await new Promise<void>((resolve,reject)=>{
                const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);wake=undefined}
                const done=()=>{cleanup();resolve()}
                const abort=()=>{cleanup();reject(signal?.reason??new Error(t('操作已取消')))}
                const timer=setTimeout(done,100)
                wake=done
                signal?.addEventListener('abort',abort,{once:true})
                if(signal?.aborted)abort()
            })
        }
        }catch(error){
            logFileRecovery(signal?.aborted?'resolve-cancelled':'resolve-error',{token,elapsedMs:Date.now()-started,error:String(error)})
            throw error
        }
    }
    const workspace:Workspace={id:`recovered:${token.host}:${token.root}`,kind:'remote',root:token.root,host:token.host,
        name:posix.basename(token.root),label:`${token.user??''}@${token.host}:${token.root}`,
        get waitForConnection(){return !findRemoteSession(app,token)},
        get connectionStatus(){return findRemoteSession(app,token)?undefined:t`正在等待 SSH 连接到 ${token.host}…`},
        list:async(path,signal)=>(await resolve(signal)).list(path,signal),
        read:async(path,signal)=>(await resolve(signal)).read(path,signal),
        readBytes:async(path,maxBytes,signal)=>(await resolve(signal)).readBytes!(path,maxBytes,signal),
        write:async(path,content,hash)=>(await resolve()).write(path,content,hash),
        run:async(command,signal,options)=>(await resolve(signal)).run(command,signal,options)}
    restored.set(workspace,{token,resolve})
    return workspace
}

export async function resolveFileWorkspace(workspace:Workspace,signal?:AbortSignal):Promise<Workspace> {
    return restored.get(workspace)?.resolve(signal)??workspace
}

