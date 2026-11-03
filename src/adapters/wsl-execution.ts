import { wslShellArguments } from '../shared/wsl-shell'
import type { Workspace } from '../arw-tree/workspace'
import { executeCaptured } from '../shared/process'
import { shellQuote } from '../shared/shell-quote'
import { isWslTerminal } from '../shared/wsl-directory'
import { wslLaunchDirectory } from '../shared/wsl-launch-directory'
import type { CommandPlan } from '../shared/command-plan'

/** Keep filesystem access on the host, but execute commands and Git in the guest. */
export function wslCommandPlan(terminal:{profile?:any},root:string,command:string):CommandPlan {
    const args:string[]=terminal.profile?.options?.args??[]
    const index=args.findIndex(arg=>arg==='-d'||arg==='--distribution')
    const distribution=index>=0?args[index+1]:args.find(arg=>arg.startsWith('--distribution='))?.slice(15)
    const userIndex=args.findIndex(arg=>arg==='-u'||arg==='--user')
    const user=userIndex>=0?args[userIndex+1]:args.find(arg=>arg.startsWith('--user='))?.slice(7)
    const parsed=wslLaunchDirectory(root)
    const directory=parsed.native?shellQuote(parsed.directory):`"$(wslpath -u ${shellQuote(root)})"`
    return {command:terminal.profile?.options?.command??'wsl.exe',args:[
        ...((distribution??parsed.distribution)?['--distribution',(distribution??parsed.distribution)!]:[]),
        ...(user?['--user',user]:[]),'--exec',...wslShellArguments(`cd -- ${directory} || exit; ${command}`)]}
}

/** UNC roots must stay in WSL even when restored without a source terminal. */
export function withWslExecution(workspace:Workspace,terminal?:{profile?:any;session?:object|null},platform:NodeJS.Platform=process.platform,execute:typeof executeCaptured=executeCaptured):Workspace {
    const root=workspace.root
    const unc=/^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]/i.test(root)
    const source=terminal&&isWslTerminal(terminal)?terminal:unc?{profile:{type:'local',options:{command:'wsl.exe',args:[]}}}:undefined
    if(platform!=='win32'||!source)return workspace
    const run:Workspace['run']=(command,signal,options)=>{
        signal?.throwIfAborted()
        return execute(wslCommandPlan(source,root,command),signal,options?.maxBytes)
    }
    workspace.executionEnvironment='wsl'
    workspace.host='WSL'
    workspace.run=run
    workspace.runGit=async(args,signal,options)=>{
        // Host paths appear in discovery, setup and sync arguments; translate in the selected guest.
        const commandIndex=args.findIndex((arg,index)=>!arg.startsWith('-')&&args[index-1]!=='-C')
        const command=args[commandIndex]
        const words=args.map((arg,index)=>(args[index-1]==='-C'||(['init','clone'].includes(command)&&index===args.length-1))&&/^(?:[a-z]:[\\/]|[\\/]{2})/i.test(arg)
            ?`"$(wslpath -u ${shellQuote(arg)})"`:shellQuote(arg))
        const result=await run(`LC_ALL=C LANGUAGE=C GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never GIT_OPTIONAL_LOCKS=0 git --no-pager --literal-pathspecs ${words.join(' ')}`,signal,options)
        // Discovery consumes a host filesystem path; other Git output remains byte-for-byte intact.
        if(result.exitCode===0&&args.includes('rev-parse')&&args.includes('--show-toplevel')){
            const path=result.stdout.replace(/\r?\n$/,'')
            const converted=await run(`wslpath -w ${shellQuote(path)}`,signal,options)
            const hostPath=converted.stdout.replace(/\r?\n$/,'')
            if(converted.exitCode!==0||converted.truncated||!/^(?:[a-z]:[\\/]|\\\\)/i.test(hostPath)||/[\x00-\x1f\x7f]/.test(hostPath))
                throw new Error(converted.stderr.trim()||'Invalid Windows path returned by WSL')
            result.stdout=hostPath+'\n'
        }
        return result
    }
    return workspace
}
