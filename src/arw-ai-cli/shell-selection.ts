import type { AgentShell } from './shell'

interface ProfileLike {
    id?: string
    name?: string
    type?: string
    isBuiltin?: boolean
    options?: { command?: unknown; args?: unknown; env?: unknown; shellType?: unknown }
}

export function selectableShells (profiles:ProfileLike[]):AgentShell[] {
    const result:AgentShell[]=[]
    for (const profile of profiles) {
        const options=profile.options
        if (profile.type!=='local'||!profile.id||typeof options?.command!=='string'||!options.command.trim()) continue
        const args=Array.isArray(options.args)?options.args.filter((arg):arg is string=>typeof arg==='string'):[]
        const env=options.env&&typeof options.env==='object'?Object.fromEntries(Object.entries(options.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')):{}
        const shellType=options.shellType==='unix'||options.shellType==='powershell'||options.shellType==='cmd'?options.shellType:null
        result.push({id:profile.id,name:profile.name||profile.id,command:options.command,args,env,shellType})
    }
    return result
}

export function sameShell (left:Partial<AgentShell>|undefined,right:AgentShell|undefined):boolean {
    if (!left||!right) return false
    return Boolean(left.id&&left.id===right.id)||(left.command===right.command
        && JSON.stringify(left.args??[])===JSON.stringify(right.args??[]))
}
