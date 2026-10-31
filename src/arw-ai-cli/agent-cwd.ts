import { createHash } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import { lstatSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, posix } from 'node:path'
import { ensurePlaceholderGuidance } from '../arw-cli/instructions'
import { readWorkspaceBinding, writeWorkspaceBinding, type WorkspaceBinding } from '../arw-cli/workspace-binding'

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

export function legacyAgentCwdPath(remoteRoot:string,storageRoot:string,identity:AgentCwdIdentity,terminalOnly=false,workspaceId?:string):string {
    if(!posix.isAbsolute(remoteRoot))throw new Error(`Agent cwd requires an absolute remote path: ${remoteRoot}`)
    return join(storageRoot,'agent-cwd',endpointPathSegment(identity),hash(posix.normalize(remoteRoot))+(terminalOnly?'-terminal'+(workspaceId?'-'+hash(workspaceId):''):''))
}

function readableSegment(value:string,escapeHyphens=false):string {
    const encoded=encodeURIComponent(value).replace(/[!'()*~]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    return escapeHyphens?encoded.replace(/-/g,'%2D'):encoded
}

export function agentCwdPath(remoteRoot:string,storageRoot:string,identity:AgentCwdIdentity,terminalOnly=false,workspaceId?:string):string {
    if(!posix.isAbsolute(remoteRoot))throw new Error(`Agent cwd requires an absolute remote path: ${remoteRoot}`)
    const port=identity.port??22
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`Agent cwd requires a valid SSH port: ${port}`)
    const root=posix.normalize(remoteRoot)
    const path=root.split('/').filter(Boolean).map(part=>readableSegment(part,true)).join('-')||'%2F'
    const suffix=terminalOnly?'--terminal'+(workspaceId?'-'+hash(workspaceId):''):''
    const prefix=`${readableSegment(identity.host)}@${port}@${readableSegment(identity.user??'',true)}-`
    let name=prefix+path+suffix
    if(Buffer.byteLength(name)>240){
        const budget=240-Buffer.byteLength(prefix+suffix)-18
        if(budget<1)throw new Error('SSH identity is too long for a placeholder directory')
        const shortened=path.slice(0,budget).replace(/%(?:[0-9A-F])?$/,'')
        name=prefix+shortened+'--'+hash(root)+suffix
    }
    // A trailing dot is not a valid directory suffix on Windows.
    name=name.replace(/\.$/,'%2E')
    return join(storageRoot,'agent-cwd',name)
}

export function isolatedAgentCwdPath(base:string,workspaceId:string):string {
    return join(dirname(base),basename(base).slice(0,220)+'--'+hash(workspaceId))
}

/** Legacy metadata is not a source of identity; remove only known generated files. */
export function removeLegacyAgentMetadata(placeholder:string,remoteRoot:string):void {
    const directory=join(placeholder,'.awm'),file=join(directory,'workspace.json')
    try{
        if(!lstatSync(directory).isDirectory()||!lstatSync(file).isFile())return
        let metadata:any
        try{metadata=JSON.parse(readFileSync(file,'utf8'))}catch{return}
        if(metadata?.version!==1||metadata.kind!=='remote'||metadata.remoteRoot!==posix.normalize(remoteRoot)
            ||typeof metadata.host!=='string'||!Number.isInteger(metadata.port)||metadata.port<1||metadata.port>65535
            ||metadata.user!==undefined&&typeof metadata.user!=='string'
            ||metadata.workspaceId!==undefined&&typeof metadata.workspaceId!=='string'
            ||metadata.terminalOnly!==undefined&&typeof metadata.terminalOnly!=='boolean'
            ||Object.keys(metadata).some(key=>!['version','kind','host','port','user','remoteRoot','terminalOnly','workspaceId'].includes(key)))return
        unlinkSync(file)
        try{rmdirSync(directory)}catch(error){if(!['ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code??''))throw error}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
}

/** A persistent local cwd representing a remote path; never a project copy or mount. */
export async function ensureAgentCwdPlaceholder (
    remoteRoot: string, storageRoot: string, identity: AgentCwdIdentity, terminalOnly=false, workspaceId?:string,binding?:WorkspaceBinding,
): Promise<AgentCwdPlaceholder> {
    if (!posix.isAbsolute(remoteRoot)) throw new Error(`Agent cwd requires an absolute remote path: ${remoteRoot}`)
    const root = posix.normalize(remoteRoot)
    let localPath = agentCwdPath(root,storageRoot,identity,terminalOnly,workspaceId)
    if(binding){
        removeLegacyAgentMetadata(localPath,root)
        const previous=readWorkspaceBinding(localPath)
        if(previous&&previous.workspaceId!==binding.workspaceId)localPath=isolatedAgentCwdPath(localPath,binding.workspaceId)
    }
    let created = false
    try { await lstat(localPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        created = true
    }
    await mkdir(localPath, { recursive: true, mode: 0o700 })
    removeLegacyAgentMetadata(localPath,root)
    if(binding)writeWorkspaceBinding(localPath,binding)
    ensurePlaceholderGuidance(localPath,root)
    return { localPath, created }
}
