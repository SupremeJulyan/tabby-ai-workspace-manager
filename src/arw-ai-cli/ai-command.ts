import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { shellQuote } from '../shared/shell-quote'
import { CODEX_FULL_ACCESS_ARGUMENTS } from './defaults'

export interface AiCommandConfiguration {
    id: string
    command: string
    resumeCommand: string
    proxyUrl: string
    legacy?: boolean
    legacyShell?: unknown
}

export interface ParsedAiCommand {
    executable: string
    args: string[]
}

export function commandTokens (command: string): string[] {
    const tokens: string[] = []
    let token = ''
    let quote: "'" | '"' | undefined
    let started = false
    for (let index = 0; index < command.length; index++) {
        const character = command[index]
        if (quote === "'") {
            if (character === "'") quote = undefined
            else token += character
            started = true
            continue
        }
        if (character === '\\' && command[index + 1] && /[\s'"\\]/.test(command[index + 1])) {
            token += command[++index]
            started = true
            continue
        }
        if (quote === '"') {
            if (character === '"') quote = undefined
            else token += character
            started = true
            continue
        }
        if (character === "'" || character === '"') {
            quote = character
            started = true
        } else if (/\s/.test(character)) {
            if (started) {
                tokens.push(token)
                token = ''
                started = false
            }
        } else {
            token += character
            started = true
        }
    }
    if (quote) throw new Error('命令中的引号未闭合')
    if (started) tokens.push(token)
    return tokens
}

export function parseAiCommand (command: string): ParsedAiCommand {
    const tokens = commandTokens(command.trim())
    const executable = tokens[0]
    if (!executable) throw new Error('请输入启动命令')
    return { executable, args: tokens.slice(1) }
}

export function aiName (command: string): string {
    const executable = commandTokens(command.trim())[0]
    if (!executable) return ''
    return basename(executable.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
}

function commandLine (executable: string, args: string[]): string {
    return [executable, ...args].map(shellQuote).join(' ')
}

export function createAiCommand (): AiCommandConfiguration {
    return { id: randomUUID(), command: '', resumeCommand: '', proxyUrl: '' }
}

export function configuredAiCommands (omw: any): AiCommandConfiguration[] {
    const agents=omw?.agents
    if (omw?.agentsConfigured === true) {
        return Array.isArray(agents) ? agents.filter((agent: any) => agent && typeof agent.command === 'string').map((agent: any, index: number) => ({
            id: typeof agent.id === 'string' && agent.id ? agent.id : `agent-${index}`,
            command: agent.command,
            resumeCommand: typeof agent.resumeCommand === 'string' ? agent.resumeCommand : '',
            proxyUrl: typeof agent.proxyUrl === 'string' ? agent.proxyUrl : '',
        })) : []
    }
    if (Array.isArray(agents) && agents.length) {
        return agents.filter((agent: any) => agent && typeof agent.command === 'string').map((agent: any, index: number) => ({
            id: typeof agent.id === 'string' && agent.id ? agent.id : `agent-${index}`,
            command: agent.command,
            resumeCommand: typeof agent.resumeCommand === 'string' ? agent.resumeCommand : '',
            proxyUrl: typeof agent.proxyUrl === 'string' ? agent.proxyUrl : '',
        }))
    }
    const legacy = omw?.agent
    if (typeof legacy?.command === 'string') {
        if (!legacy.command.trim()) return []
        const args = Array.isArray(legacy.args) ? legacy.args.filter((argument: unknown): argument is string => typeof argument === 'string') : []
        const resumeArgs = Array.isArray(legacy.resumeArgs) ? legacy.resumeArgs.filter((argument: unknown): argument is string => typeof argument === 'string') : undefined
        const command=commandLine(legacy.command,args)
        return [{
            id: 'legacy-agent',
            command,
            resumeCommand: resumeArgs === undefined ? '' : commandLine(legacy.command, resumeArgs),
            proxyUrl: typeof legacy.proxyUrl === 'string' ? legacy.proxyUrl : '',
            legacy: true,
            legacyShell: legacy.shell,
        }, ...(aiName(command)==='claude'?[]:[defaultClaudeCommand()])]
    }
    return [defaultCodexCommand(),defaultClaudeCommand()]
}

function defaultCodexCommand (): AiCommandConfiguration {
    const args=[...CODEX_FULL_ACCESS_ARGUMENTS]
    return {
        id: 'default-codex',
        command: ['codex',...args].join(' '),
        resumeCommand: ['codex','resume','--last',...args].join(' '),
        proxyUrl: '',
    }
}

function defaultClaudeCommand (): AiCommandConfiguration {
    const args=['--dangerously-skip-permissions']
    return {
        id: 'default-claude',
        command: ['claude',...args].join(' '),
        resumeCommand: ['claude','--continue',...args].join(' '),
        proxyUrl: '',
    }
}
