import { t } from '../shared/i18n'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { currentCliPath } from './cli-path'
import { cliGuidance, terminalCliGuidance } from '../arw-cli/instructions'

interface AgentOptions {
    command?: string; args?: string[]; cwd?: string; env?: Record<string,string>
    [key:string]: unknown
}
interface AgentTerminal {
    profile: {type:string; options:AgentOptions; [key:string]:unknown}
    getRecoveryToken?: (...args:any[])=>Promise<any>
    sessionOptions?: unknown
}
const wrapped = new WeakSet<object>()

/** Keep explicitly configured continuation commands; scope automatic recovery to the cwd. */
export function resumeArguments(command:string,args:string[]):string[] {
    const executable=basename(command.replace(/\\/g,'/')).replace(/\.(exe|cmd|bat)$/i,'').toLowerCase()
    if(executable==='codex'){
        if(['resume','exec','fork','review'].includes(args[0]))return [...args]
        return ['resume','--last',...args]
    }
    if(executable==='claude'){
        if(args.some(arg=>['--continue','-c','--resume','-r'].includes(arg)||arg.startsWith('--resume=')))return [...args]
        return ['--continue',...args]
    }
    return [...args]
}

function managedFile(path:string,content:string,mode=0o600):void {
    try {if(readFileSync(path,'utf8')===content)return} catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const temporary=`${path}.${randomUUID()}.tmp`
    try {writeFileSync(temporary,content,{mode,flag:'wx'});renameSync(temporary,path)}
    finally {rmSync(temporary,{force:true})}
}

/** Runs synchronously in TerminalDecorator.attach, before Tabby starts the restored PTY. */
export function prepareAiRecovery(terminal:AgentTerminal,storageRoot:string,cliSource:string,configuredResumeArgs?:string[]|null):void {
    const profile=terminal.profile,options=profile?.options,env=options?.env
    if(profile?.type!=='local'||!env?.ARW_WORKSPACE_ROOT||!options.command)return
    const cwd=env.ARW_LOCAL_WORKSPACE_ROOT??options.cwd??env.ARW_WORKSPACE_ROOT
    if(env.ARW_LOCAL_WORKSPACE_ROOT){
        const path=relative(join(storageRoot,'agent-cwd'),cwd)
        if(!path||isAbsolute(path)||path==='..'||path.startsWith(`..${sep}`))throw new Error(t('AI 占位目录不属于当前 Tabby 配置'))
        const metadata=JSON.parse(readFileSync(join(cwd,'.awm','workspace.json'),'utf8'))
        if(metadata.version!==1||metadata.kind!=='remote'||metadata.remoteRoot!==env.ARW_WORKSPACE_ROOT)throw new Error(t('AI 工作区元数据不匹配'))
        managedFile(join(cwd,'AGENTS.md'),metadata.terminalOnly?terminalCliGuidance:cliGuidance)
    }
    const recoveredEnv:Record<string,string>={...env,PATH:currentCliPath(cliSource)}
    delete recoveredEnv.ARW_CONFIG
    delete recoveredEnv.ARW_AI_FRESH_START
    if(configuredResumeArgs!=null&&(!Array.isArray(configuredResumeArgs)||configuredResumeArgs.some(arg=>typeof arg!=='string')))throw new Error(t('恢复会话参数必须是字符串数组'))
    const explicit=configuredResumeArgs!=null
    const savedExplicit=configuredResumeArgs===undefined&&env.ARW_AI_RECOVERY_CONFIGURED==='1'
    const args=explicit?[...configuredResumeArgs]:savedExplicit?[...(options.args??[])]:resumeArguments(options.command,options.args??[])
    if(explicit)recoveredEnv.ARW_AI_RECOVERY_CONFIGURED='1'
    else if(configuredResumeArgs===null)delete recoveredEnv.ARW_AI_RECOVERY_CONFIGURED
    if(env.ARW_AI_FRESH_START!=='1'){
        terminal.profile={...profile,options:{...options,args,cwd,env:recoveredEnv}}
        if('sessionOptions' in terminal)terminal.sessionOptions=terminal.profile.options
    }
    if(!terminal.getRecoveryToken||wrapped.has(terminal))return
    wrapped.add(terminal)
    const getToken=terminal.getRecoveryToken.bind(terminal)
    terminal.getRecoveryToken=async(...parameters)=>{
        const token=await getToken(...parameters)
        if(!token||token.type!=='app:local-tab'||!token.profile)return token
        return {...token,profile:{...token.profile,options:{...token.profile.options,args,cwd,env:recoveredEnv}}}
    }
}
