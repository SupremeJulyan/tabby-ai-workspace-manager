import { t } from '../shared/i18n'
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { currentCliPath } from './cli-path'
import { ensurePlaceholderGuidance } from '../arw-cli/instructions'
import { agentCwdPath, isolatedAgentCwdPath, legacyAgentCwdPath, removeLegacyAgentMetadata } from './agent-cwd'
import { readWorkspaceBinding, writeWorkspaceBinding } from '../arw-cli/workspace-binding'
import { agentShellFromOptions, isAgentProfile } from './agent-profile'
import { replaceShellArguments, shellCommand, shellEnvironment, type ShellType } from './shell'

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

/** Windows shells cannot execute the Unix manager shim; use the stable launcher beside it. */
function persistentCliSource(source:string):string {
    const launcher=join(dirname(source),'arw-launcher.cjs')
    try {if(readFileSync(launcher,'utf8').includes(source))return launcher} catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    return source
}

function ensureExecutable(path:string):void {
    try {chmodSync(path,0o755)} catch(error) {if((error as NodeJS.ErrnoException).code!=='EPERM'&&(error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
}

/** Runs synchronously in TerminalDecorator.attach, before Tabby starts the restored PTY. */
export function prepareAiRecovery(terminal:AgentTerminal,storageRoot:string,cliSource:string,configuredResumeArgs?:string[]|null):void {
    const profile=terminal.profile,options=profile?.options,env=options?.env
    if(profile?.type!=='local'||!env?.ARW_WORKSPACE_ROOT||!options.command)return
    const cwd=env.ARW_LOCAL_WORKSPACE_ROOT??options.cwd??env.ARW_WORKSPACE_ROOT
    if(env.ARW_LOCAL_WORKSPACE_ROOT){
        const path=relative(join(storageRoot,'agent-cwd'),cwd)
        if(!path||isAbsolute(path)||path==='..'||path.startsWith(`..${sep}`))throw new Error(t('AI 占位目录不属于当前 Tabby 配置'))
        const binding=readWorkspaceBinding(cwd,true)
        if(binding&&env.ARW_WORKSPACE_ID&&binding.workspaceId!==env.ARW_WORKSPACE_ID)throw new Error(t('AI 工作区元数据不匹配'))
        const remoteRoot=binding?.remoteRoot??env.ARW_WORKSPACE_ROOT
        if(env.ARW_TERMINAL_MODE!==undefined&&!['0','1'].includes(env.ARW_TERMINAL_MODE))throw new Error(t('AI 工作区元数据不匹配'))
        const terminalMode=binding?.terminalOnly??(env.ARW_TERMINAL_MODE===undefined?/(?:^[a-f0-9]{16}-terminal|--terminal)(?:-[a-f0-9]{16})?$/.test(basename(cwd)):env.ARW_TERMINAL_MODE==='1')
        const identity={host:binding?.host??env.ARW_WORKSPACE_HOST??'',port:binding?.port??Number(env.ARW_WORKSPACE_PORT??22),user:binding?.user??env.ARW_WORKSPACE_USER??''}
        const workspaceId=binding?.workspaceId??env.ARW_WORKSPACE_ID
        const candidates=[agentCwdPath,legacyAgentCwdPath].map(make=>make(remoteRoot,storageRoot,identity,terminalMode,terminalMode?workspaceId:undefined))
        if(workspaceId)candidates.push(isolatedAgentCwdPath(candidates[0],workspaceId))
        const matches=candidates.some(expected=>{
            const expectedName=basename(expected),actualName=basename(cwd)
            const legacyTerminal=terminalMode&&!workspaceId&&actualName.startsWith(expectedName+'-')&&/^[a-f0-9]{16}$/.test(actualName.slice(expectedName.length+1))
            return (actualName===expectedName||legacyTerminal)&&(!(binding?.host||env.ARW_WORKSPACE_HOST)||dirname(cwd)===dirname(expected))
        })
        if(!matches)throw new Error(t('AI 工作区元数据不匹配'))
        mkdirSync(cwd,{recursive:true,mode:0o700})
        removeLegacyAgentMetadata(cwd,remoteRoot)
        // Migrate only identity saved on this verified terminal profile, not process.env.
        if(!binding&&workspaceId&&identity.host)writeWorkspaceBinding(cwd,{version:2,kind:'remote',workspaceId,remoteRoot,...identity,terminalOnly:terminalMode,catalogPath:join(dirname(storageRoot),'omw','workspaces.json')})
        ensurePlaceholderGuidance(cwd,remoteRoot)
    }
    const savedPath=Object.entries(env).find(([name])=>name.toLowerCase()==='path')?.[1]
    const executableCli=process.platform==='win32'?persistentCliSource(cliSource):cliSource
    ensureExecutable(executableCli)
    const recoveredEnv:Record<string,string>={}
    const pathName=Object.keys(env).find(name=>name.toLowerCase()==='path')??'PATH'
    for(const key of Object.keys(env))if(key.toLowerCase()!=='path')recoveredEnv[key]=env[key]
    delete recoveredEnv.ARW_WORKSPACE_ID
    delete recoveredEnv.ARW_TERMINAL_MODE
    recoveredEnv[pathName]=currentCliPath(executableCli,savedPath??process.env.PATH??'')
    delete recoveredEnv.ARW_CONFIG
    delete recoveredEnv.ARW_AI_FRESH_START
    if(configuredResumeArgs!=null&&(!Array.isArray(configuredResumeArgs)||configuredResumeArgs.some(arg=>typeof arg!=='string')))throw new Error(t('恢复会话参数必须是字符串数组'))
    const explicit=configuredResumeArgs!=null
    const savedExplicit=configuredResumeArgs===undefined&&env.ARW_AI_RECOVERY_CONFIGURED==='1'
    const agentCommand=isAgentProfile(options)?env.ARW_AGENT_COMMAND:options.command
    let agentArgs:string[]=[]
    if(isAgentProfile(options)) {
        try {const parsed=JSON.parse(env.ARW_AGENT_ARGS??'[]');if(!Array.isArray(parsed)||parsed.some(arg=>typeof arg!=='string'))throw new Error() ;agentArgs=parsed}
        catch {throw new Error(t('恢复参数无效'))}
    } else agentArgs=options.args??[]
    const args=explicit?[...configuredResumeArgs]:savedExplicit?[...agentArgs]:resumeArguments(agentCommand,agentArgs)
    let launchOptions:{command:string;args:string[];shellType?:string|null}={command:agentCommand,args}
    if(isAgentProfile(options)) {
        const shellCommandValue=env.ARW_AGENT_SHELL_COMMAND
        const savedShellType=env.ARW_AGENT_SHELL_TYPE
        const configuredShellType:ShellType|null=savedShellType==='unix'||savedShellType==='powershell'||savedShellType==='cmd'?savedShellType:null
        const savedShellArgs=env.ARW_AGENT_SHELL_ARGS
        if(shellCommandValue) {
            let shellArguments:string[]=[]
            if(savedShellArgs) {
                try {
                    const parsedShellArgs=JSON.parse(savedShellArgs)
                    if(!Array.isArray(parsedShellArgs)||parsedShellArgs.some(argument=>typeof argument!=='string'))throw new Error()
                    shellArguments=parsedShellArgs
                } catch {throw new Error(t('恢复 Shell 参数无效'))}
            }
            const envForShell=shellEnvironment({command:shellCommandValue,args:shellArguments,env:recoveredEnv,shellType:configuredShellType},recoveredEnv)
            const launch=shellCommand({command:shellCommandValue,args:shellArguments,env:envForShell,shellType:configuredShellType},[agentCommand].concat(args))
            launchOptions={command:launch.command,args:launch.args,shellType:launch.shellType}
        } else {
            const shell=agentShellFromOptions(options)
            if(!shell)throw new Error(t('未找到原 AI 终端使用的 Shell'))
            const envForShell=shellEnvironment(shell,recoveredEnv)
            const launch=replaceShellArguments({...shell,args:shell.args??[],env:envForShell,shellType:shell.shellType??null},[agentCommand].concat(args))
            launchOptions={command:launch.command,args:launch.args,shellType:launch.shellType}
        }
        recoveredEnv.ARW_AGENT_ARGS=JSON.stringify(args)
    }
    if(explicit)recoveredEnv.ARW_AI_RECOVERY_CONFIGURED='1'
    else if(configuredResumeArgs===null)delete recoveredEnv.ARW_AI_RECOVERY_CONFIGURED
    if(env.ARW_AI_FRESH_START!=='1'){
        terminal.profile={...profile,options:{...options,...launchOptions,cwd,env:recoveredEnv}}
        if('sessionOptions' in terminal)terminal.sessionOptions=terminal.profile.options
    }
    if(!terminal.getRecoveryToken||wrapped.has(terminal))return
    wrapped.add(terminal)
    const getToken=terminal.getRecoveryToken.bind(terminal)
    terminal.getRecoveryToken=async(...parameters)=>{
        const token=await getToken(...parameters)
        if(!token||token.type!=='app:local-tab'||!token.profile)return token
        return {...token,profile:{...token.profile,options:{...token.profile.options,...launchOptions,cwd,env:recoveredEnv}}}
    }
}
