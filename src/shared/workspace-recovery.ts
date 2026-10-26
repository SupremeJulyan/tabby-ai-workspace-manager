import { shellQuote } from './shell-quote'

export interface WorkspaceRecoveryState {root:string;mode:'files'|'git'|'activity';cwd?:string}
interface Terminal {
    profile:any
    session?:{getWorkingDirectory():Promise<string|null> }|null
    getRecoveryToken:(...args:any[])=>Promise<any>
}
const states=new WeakMap<object,WorkspaceRecoveryState>()
const attached=new WeakSet<object>()
const validPath=(value:unknown):value is string=>typeof value==='string'&&/^(?:\/|[a-z]:[\\/])/i.test(value)&&!/[\x00-\x1f\x7f]/.test(value)
export function workspaceRecoveryState(terminal:object):WorkspaceRecoveryState|undefined{return states.get(terminal)}
export function rememberWorkspace(terminal:object,root:string,mode:WorkspaceRecoveryState['mode']):void {
    if(validPath(root))states.set(terminal,{...states.get(terminal),root,mode})
}
/** Persist only this tab's paths; never modify the saved connection profile. */
export function prepareWorkspaceRecovery(terminal:Terminal):void {
    if(attached.has(terminal)||!terminal.getRecoveryToken||terminal.profile?.options?.env?.ARW_WORKSPACE_ROOT)return
    if(!['local','ssh'].includes(terminal.profile?.type))return
    attached.add(terminal)
    const saved=terminal.profile.options?.arwWorkspace
    if(validPath(saved?.root)){
        const state:WorkspaceRecoveryState={root:saved.root,mode:['files','git','activity'].includes(saved.mode)?saved.mode:'files',cwd:validPath(saved.cwd)?saved.cwd:undefined}
        states.set(terminal,state)
        const options={...terminal.profile.options}
        if(terminal.profile.type==='local'&&state.cwd)options.cwd=state.cwd
        if(terminal.profile.type==='ssh'){
            const cwd=state.cwd??state.root
            // Tabby's login script processor unescapes backslashes before sending.
            const send=(` cd -- ${shellQuote(cwd)}`).replace(/\\/g,'\\\\')
            const scripts=(options.scripts??[]).filter((script:any)=>!script.arwRestoreDirectory)
            const conditional=scripts.findIndex((script:any)=>Boolean(script.expect))
            scripts.splice(conditional<0?scripts.length:conditional,0,{expect:'',send,arwRestoreDirectory:true})
            options.scripts=scripts
        }
        terminal.profile={...terminal.profile,options}
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
        return {...token,profile:{...token.profile,options}}
    }
}
