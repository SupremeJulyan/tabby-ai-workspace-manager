import { shellArgumentLine, type AgentShell } from './shell'

export interface ConfiguredShell {
    id?: unknown
    name?: unknown
    command?: unknown
    args?: unknown
    env?: unknown
    shellType?: unknown
}

/** The plugin must never fall back to executing an AI CLI outside a selected shell. */
export function configuredShell (selected:ConfiguredShell|undefined):AgentShell {
    if (!selected||typeof selected.command!=='string'||!selected.command.trim()) {
        throw new Error('请先在 Tabby 设置 → ai-workspace-manager 中选择启动 Shell')
    }
    const args=Array.isArray(selected.args)?selected.args.filter((arg):arg is string=>typeof arg==='string'):[]
    const env=selected.env&&typeof selected.env==='object'
        ?Object.fromEntries(Object.entries(selected.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')):{}
    return {id:typeof selected.id==='string'?selected.id:undefined,name:typeof selected.name==='string'?selected.name:undefined,command:selected.command.trim(),args,env,
        shellType:selected.shellType==='unix'||selected.shellType==='powershell'||selected.shellType==='cmd'?selected.shellType:null}
}

export function shellDescription (args:string[]):string {
    return shellArgumentLine(args)
}
