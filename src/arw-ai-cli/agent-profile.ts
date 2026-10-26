import type { AgentShell } from './shell'

export interface AgentProfileOptions {
    command?: string
    args?: string[]
    env?: Record<string,string>
    [key:string]: unknown
}

export function agentShellFromOptions (options:AgentProfileOptions|undefined):AgentShell|undefined {
    if (typeof options?.command!=='string'||!options.command.trim()) return undefined
    return {
        command:options.command,
        args:Array.isArray(options.args)?options.args.filter((arg):arg is string=>typeof arg==='string'):[],
        env:options.env??{},
        shellType:options.shellType==='unix'||options.shellType==='powershell'||options.shellType==='cmd'?options.shellType:null,
    }
}

export function isAgentProfile (options:AgentProfileOptions|undefined):boolean {
    return typeof options?.env?.ARW_AGENT_COMMAND==='string'&&options.env.ARW_AGENT_COMMAND.trim().length>0
}
