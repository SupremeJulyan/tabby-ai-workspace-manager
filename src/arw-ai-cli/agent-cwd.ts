import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { cliGuidance, terminalCliGuidance } from '../arw-cli/instructions'

export interface AgentCwdIdentity { host: string; port?: number; user?: string }
export interface AgentCwdPlaceholder { localPath: string; created: boolean }

// Adapted from the VS Code SAFS agent-cwd implementation (MIT).
export function safeAgentCwdName (name: string): string {
    const encoded = [...name.normalize('NFKC').trim()].map(character =>
        /[\p{L}\p{N}._@-]/u.test(character) ? character : '_'
    ).join('').replace(/_+/g, '_').replace(/^[. ]+|[. ]+$/g, '')
    const shortened = [...encoded].slice(0, 48).join('') || 'mount'
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(shortened) ? `_${shortened}` : shortened
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)

function endpointPathSegment (identity: AgentCwdIdentity): string {
    const port = identity.port ?? 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Agent cwd requires a valid SSH port: ${port}`)
    }
    const octets = identity.host.split('.')
    const host = octets.length === 4 && octets.every(part =>
        /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
        ? octets.map(part => Number(part).toString(16).padStart(2, '0')).join('')
        : Buffer.from(identity.host, 'utf8').toString('hex')
    return `${host}-${port.toString(16)}`
}

/** A persistent local cwd representing a remote path; never a project copy or mount. */
export async function ensureAgentCwdPlaceholder (
    remoteRoot: string, storageRoot: string, identity: AgentCwdIdentity, terminalOnly=false, workspaceId?:string,
): Promise<AgentCwdPlaceholder> {
    if (!posix.isAbsolute(remoteRoot)) throw new Error(`Agent cwd requires an absolute remote path: ${remoteRoot}`)
    const root = posix.normalize(remoteRoot)
    const localPath = join(storageRoot, 'agent-cwd', endpointPathSegment(identity), hash(root)+(terminalOnly?'-terminal'+(workspaceId?'-'+hash(workspaceId):''):''))
    let created = false
    try { await lstat(localPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        created = true
    }
    await mkdir(localPath, { recursive: true, mode: 0o700 })
    const metadata = join(localPath, '.awm')
    await mkdir(metadata, { recursive: true, mode: 0o700 })
    await writeFile(join(metadata, 'workspace.json'), JSON.stringify({ version: 1, kind: 'remote',
        ...identity, port: identity.port ?? 22, remoteRoot: root, ...(terminalOnly?{terminalOnly:true,workspaceId}:{}) }, null, 2) + '\n', { mode: 0o600 })
    await writeFile(join(localPath, 'AGENTS.md'), terminalOnly?terminalCliGuidance:cliGuidance, { mode: 0o600, flag: 'wx' })
        .catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    return { localPath, created }
}
