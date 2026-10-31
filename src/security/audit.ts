import { lstat, mkdir, rename, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { constants } from 'node:fs'
import { redactSensitiveText } from '../shared/redact'

export interface AuditEntry {
    workspaceId: string
    operation: string
    outcome: 'requested'|'allowed'|'denied'|'completed'|'failed'
    command?: string
    path?: string
    requestId: string
}

const queues = new Map<string, Promise<void>>()

export function appendAudit (file: string, entry: AuditEntry): Promise<void> {
    const pending = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        await mkdir(dirname(file), {recursive: true, mode: 0o700})
        const current = await lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
        if (current && !current.isFile()) throw new Error('Audit log is not a regular file')
        if (current && current.size >= 1024 * 1024) await rename(file, `${file}.1`)
        const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600)
        try {
            await handle.chmod(0o600)
            const safe = {...entry, command: entry.command === undefined ? undefined : redactSensitiveText(entry.command).slice(0, 8192),
                path: entry.path === undefined ? undefined : redactSensitiveText(entry.path).slice(0, 2048)}
            await handle.appendFile(JSON.stringify({timestamp: new Date().toISOString(), ...safe}) + '\n')
        } finally { await handle.close() }
    })
    queues.set(file, pending)
    void pending.finally(() => { if (queues.get(file) === pending) queues.delete(file) }).catch(() => undefined)
    return pending
}
