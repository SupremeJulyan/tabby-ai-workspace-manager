import { basename } from 'node:path'

export const CODEX_FULL_ACCESS_ARGUMENTS = [
    '--sandbox', 'danger-full-access',
    '--ask-for-approval', 'on-request',
] as const

export function defaultAgentArguments (command:string):string[] {
    const executable=basename(command.replace(/\\/g,'/')).replace(/\.(exe|cmd|bat)$/i,'').toLowerCase()
    return executable==='codex'?[...CODEX_FULL_ACCESS_ARGUMENTS]:[]
}
