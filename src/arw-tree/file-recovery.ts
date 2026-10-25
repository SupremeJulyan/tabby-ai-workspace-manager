import type { AppService } from 'tabby-core'
import { posix, isAbsolute, resolve as resolvePath } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { t } from '../shared/i18n'
import { localWorkspace, type Workspace } from './workspace'
import { isSshTab } from '../adapters/ssh-compat'
import { remoteWorkspace, remoteWorkspaceSession } from '../adapters/remote-workspace'
import type { FileSessionPool } from '../services/file-session-pool'

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
        while(true){
            signal?.throwIfAborted()
            const session=await acquire(signal)??findRemoteSession(app,token)
            signal?.throwIfAborted()
            if(session)return remoteWorkspace(session,token.root)
            await delay(100,undefined,{signal})
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

