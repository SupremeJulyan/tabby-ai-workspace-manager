import { wslDirectoryArguments } from './wsl-launch-directory'
import { isWslTerminal } from './wsl-directory'
import { terminalDirectoryCommand } from './terminal-directory-command'
import { logOperation } from '../services/operation-log'
import { workspaceTerminalId } from './workspace-pane-visibility'

export interface WorkspaceRecoveryState {root:string;mode:'files'|'git'|'activity'}
interface Terminal {
    profile:any
    getRecoveryToken:(...args:any[])=>Promise<any>
}
const states=new WeakMap<object,WorkspaceRecoveryState>()
const attached=new WeakSet<object>()
const persist=new WeakMap<object,()=>void>()
const validPath=(value:unknown):value is string=>typeof value==='string'&&/^(?:\/|[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value)&&!/[\x00-\x1f\x7f]/.test(value)
export function workspaceRecoveryState(terminal:object):WorkspaceRecoveryState|undefined{return states.get(terminal)}
export function rememberWorkspace(terminal:object,root:string,mode:WorkspaceRecoveryState['mode']):void {
    if(!validPath(root))return
    const previous=states.get(terminal)
    if(previous?.root===root&&previous.mode===mode)return
    states.set(terminal,{...previous,root,mode})
    logOperation('记忆工作区目录',{root,mode})
    persist.get(terminal)?.()
}
function profileState(profile:any):WorkspaceRecoveryState|undefined {
    const options=profile.options
    const saved=options?.arwWorkspace??options?.__getValue?.('arwWorkspace')
    return saved&&typeof saved.root==='string'?{root:saved.root,mode:['files','git','activity'].includes(saved.mode)?saved.mode:'files'}:undefined
}
export function restoredWorkspaceProfile(profile:any):any {
    const state=profileState(profile)
    if(!state||!validPath(state.root))return profile
    const options={...profile.options,arwWorkspace:state}
    if(profile.type==='local'&&validPath(state.root)){
        options.cwd=state.root
        if(isWslTerminal({profile})){
            options.args=wslDirectoryArguments(options.args??[],state.root)
            options.homeDirArgs=[]
        }
    }
    if(profile.type==='ssh'){
        // Tabby's login script processor unescapes backslashes before sending.
        const send=(` ${terminalDirectoryCommand({profile},state.root)}`).replace(/\\/g,'\\\\')
        const scripts=(options.scripts??[]).filter((script:any)=>!script.arwRestoreDirectory&&!script.arwWorkspaceDirectory)
        const conditional=scripts.findIndex((script:any)=>Boolean(script.expect))
        scripts.splice(conditional<0?scripts.length:conditional,0,{expect:'',send,arwRestoreDirectory:true})
        options.scripts=scripts
    }
    return {...profile,options}
}

/** Persist only this tab's paths; never modify the saved connection profile. */
export function prepareWorkspaceRecovery(terminal:Terminal,save?:()=>void):void {
    if(attached.has(terminal)||!terminal.getRecoveryToken||terminal.profile?.options?.env?.ARW_WORKSPACE_ROOT)return
    if(!['local','ssh'].includes(terminal.profile?.type))return
    attached.add(terminal)
    if(save)persist.set(terminal,save)
    const saved=profileState(terminal.profile)
    if(saved&&validPath(saved.root)){
        states.set(terminal,{root:saved.root,mode:['files','git','activity'].includes(saved.mode)?saved.mode:'files'})
        terminal.profile=restoredWorkspaceProfile(terminal.profile)
        logOperation('恢复工作区目录',{root:saved.root,profileType:terminal.profile.type})
    }
    const original=terminal.getRecoveryToken.bind(terminal)
    terminal.getRecoveryToken=async(...args)=>{
        const token=await original(...args)
        if(!token?.profile)return token
        const projectId=workspaceTerminalId(terminal)
        if(projectId)token.profile={...token.profile,options:{...token.profile.options,arwProjectWorkspaceId:projectId}}
        const state=states.get(terminal)
        if(!state)return token
        const options={...token.profile.options,arwWorkspace:state}
        if(terminal.profile.type==='local')options.cwd=state.root
        if(Array.isArray(options.scripts))options.scripts=options.scripts.filter((script:any)=>!script.arwRestoreDirectory)
        return {...token,type:`arw-workspace:${terminal.profile.type}`,profile:{...token.profile,options}}
    }
}
