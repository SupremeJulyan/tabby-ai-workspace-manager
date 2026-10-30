import { shellQuote } from './shell-quote'
import { logOperation } from '../services/operation-log'

export interface WorkspaceRecoveryState {root:string;mode:'files'|'git'|'activity';cwd?:string}
interface Terminal {
    profile:any
    session?:{getWorkingDirectory():Promise<string|null> }|null
    getRecoveryToken:(...args:any[])=>Promise<any>
}
const states=new WeakMap<object,WorkspaceRecoveryState>()
const attached=new WeakSet<object>()
const persist=new WeakMap<object,()=>void>()
const validPath=(value:unknown):value is string=>typeof value==='string'&&/^(?:\/|[a-z]:[\\/])/i.test(value)&&!/[\x00-\x1f\x7f]/.test(value)
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
    return options?.arwWorkspace??options?.__getValue?.('arwWorkspace')
}
export function restoredWorkspaceProfile(profile:any):any {
    const state=profileState(profile)
    if(!state||!validPath(state.root))return profile
    const options={...profile.options,arwWorkspace:state}
    if(profile.type==='local'&&validPath(state.cwd))options.cwd=state.cwd
    if(profile.type==='ssh'){
        const cwd=validPath(state.cwd)?state.cwd:state.root
        // Tabby's login script processor unescapes backslashes before sending.
        const send=(` cd -- ${shellQuote(cwd)}`).replace(/\\/g,'\\\\')
        const scripts=(options.scripts??[]).filter((script:any)=>!script.arwRestoreDirectory)
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
        states.set(terminal,{root:saved.root,mode:['files','git','activity'].includes(saved.mode)?saved.mode:'files',cwd:validPath(saved.cwd)?saved.cwd:undefined})
        terminal.profile=restoredWorkspaceProfile(terminal.profile)
        logOperation('恢复工作区目录',{root:saved.root,cwd:saved.cwd,profileType:terminal.profile.type})
    }
    const original=terminal.getRecoveryToken.bind(terminal)
    terminal.getRecoveryToken=async(...args)=>{
        const token=await original(...args)
        if(!token?.profile)return token
        const state=states.get(terminal)
        if(!state)return token
        let cwd=state.cwd
        try{const reported=await terminal.session?.getWorkingDirectory();if(validPath(reported))cwd=reported}catch{}
        const options={...token.profile.options,arwWorkspace:{...state,cwd}}
        if(terminal.profile.type==='local'&&cwd)options.cwd=cwd
        if(Array.isArray(options.scripts))options.scripts=options.scripts.filter((script:any)=>!script.arwRestoreDirectory)
        return {...token,type:`arw-workspace:${terminal.profile.type}`,profile:{...token.profile,options}}
    }
}
