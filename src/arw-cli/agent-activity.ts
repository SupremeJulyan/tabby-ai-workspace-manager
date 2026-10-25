import { randomUUID } from 'node:crypto'
import { commands } from './commands'
import { redactSensitiveText } from '../shared/redact'
import { leafName } from '../shared/workspace-name'

export type ActivityStatus = 'running'|'success'|'error'|'denied'
export interface AgentActivity {
    terminalScope?: string
    id: number
    operation: string
    category: 'read'|'write'|'command'
    status: ActivityStatus
    workspaceId: string
    root: string
    name?: string
    host: string
    command?: string
    path?: string
    startedAt: number
    durationMs?: number
    exitCode?: number
    error?: string
}

function safeText (text: string): string {
    return redactSensitiveText(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 2048)
}

export class AgentActivityStore {
    private events: AgentActivity[] = []
    private listeners = new Set<()=>void>()
    private sequence = 0
    constructor (private limit = 200, private now = () => Date.now()) {}
    snapshot (terminalScope?: string): AgentActivity[] { return this.events.filter(event => terminalScope === undefined || event.terminalScope === terminalScope).map(event => ({...event})).reverse() }
    subscribe (listener: ()=>void): ()=>void {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }
    start (workspace: {id:string;root:string;host:string}, input: {name?:unknown;arguments?:unknown}, terminalScope?: string): number {
        const args = input.arguments && typeof input.arguments === 'object' ? input.arguments as Record<string, unknown> : {}
        const operation = typeof input.name === 'string' && Object.values(commands).some(command => command.tool === input.name) ? input.name : 'invalid'
        const event: AgentActivity = {terminalScope, id: ++this.sequence, operation,
            category: operation === 'run_remote_command' ? 'command' : ['remote_write', 'remote_edit', 'remote_create', 'remote_delete', 'remote_chmod', 'remote_move', 'remote_cp'].includes(operation) ? 'write' : 'read',
            status: 'running', workspaceId: safeText(workspace.id), root: safeText(workspace.root), name: safeText(leafName(workspace.root)), host: safeText(workspace.host),
            startedAt: this.now(), command: typeof args.command === 'string' ? safeText(args.command) : undefined,
            path: typeof args.path === 'string' ? safeText(args.path) : undefined}
        this.events.push(event)
        if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
        this.emit()
        return event.id
    }
    finish (id: number, result?: unknown, error?: unknown, denied = false): void {
        const event = this.events.find(candidate => candidate.id === id)
        if (!event || event.status !== 'running') return
        const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
        event.exitCode = typeof value.exitCode === 'number' ? value.exitCode : undefined
        event.status = denied ? 'denied' : error !== undefined || value.status === 'error' || (Array.isArray(value.results) && value.results.some(result => result?.ok === false)) || (event.exitCode !== undefined && event.exitCode !== 0) ? 'error' : 'success'
        event.durationMs = Math.max(0, this.now() - event.startedAt)
        if (error !== undefined) event.error = safeText(error instanceof Error ? error.message : String(error))
        this.emit()
    }
    clear (terminalScope?: string): void {
        this.events = this.events.filter(event => event.status === 'running' || (terminalScope !== undefined && event.terminalScope !== terminalScope))
        this.emit()
    }
    private emit (): void {
        for (const listener of this.listeners) { try { listener() } catch {} }
    }
}

export const agentActivity = new AgentActivityStore()

const terminalScopes = new WeakMap<object, string>()
export function activityScope (terminal: object): string {
    let scope = terminalScopes.get(terminal)
    if (!scope) { scope = randomUUID(); terminalScopes.set(terminal, scope) }
    return scope
}
