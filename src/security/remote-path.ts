import { posix } from 'node:path'
import { shellQuote } from '../shared/shell-quote'

export function isRemotePathInsideRoot (root: string, target: string): boolean {
    if (!posix.isAbsolute(root) || !posix.isAbsolute(target)) return false
    const normalized = posix.resolve(root)
    const resolved = posix.resolve(target)
    return resolved === normalized || resolved.startsWith(normalized === '/' ? '/' : `${normalized}/`)
}

type Run = (command: string, signal?: AbortSignal) => Promise<{stdout: string; stderr: string; exitCode: number|null}>

export class RemotePathError extends Error {}

export class RemotePathGuard {
    constructor (private root: string, private run: Run) {}


    /** Read paths use the SSH account's permissions, without a workspace boundary. */
    async resolveRead(input:string,signal?:AbortSignal,allowMissing=false):Promise<string> {
        signal?.throwIfAborted()
        if(!posix.isAbsolute(this.root)||/[\x00-\x1f\x7f]/.test(this.root+input))throw new RemotePathError('Invalid remote path')
        const target=posix.resolve(this.root,input)
        const result=await this.run(`realpath -${allowMissing?'m':'e'} -- ${shellQuote(target)}`,signal)
        signal?.throwIfAborted()
        const resolved=result.stdout.replace(/\n$/,'')
        if(result.exitCode!==0||!posix.isAbsolute(resolved)||/[\x00-\x1f\x7f]/.test(resolved))
            throw new RemotePathError('Cannot resolve remote read path')
        return resolved
    }

    async resolveDirectory (input:string, signal?:AbortSignal):Promise<string> {
        signal?.throwIfAborted()
        if (!posix.isAbsolute(this.root) || /[\x00-\x1f\x7f]/.test(this.root + input)) throw new RemotePathError('Invalid remote path')
        const target=posix.resolve(this.root,input)
        if(!isRemotePathInsideRoot(this.root,target))throw new RemotePathError('Path is outside workspaceRoot')
        const result=await this.run(`(cd -- ${shellQuote(this.root)} && pwd -P) && (cd -- ${shellQuote(target)} && pwd -P)`,signal)
        signal?.throwIfAborted()
        if(result.exitCode!==0)throw new RemotePathError('Cannot safely resolve remote directory')
        const lines=result.stdout.replace(/\n$/,'').split('\n')
        if(lines.length!==2||lines.some(line=>!posix.isAbsolute(line)||/[\x00-\x1f\x7f]/.test(line)))throw new RemotePathError('Invalid remote directory response')
        if(!isRemotePathInsideRoot(lines[0],lines[1]))throw new RemotePathError('Path escapes workspaceRoot through a symbolic link')
        return lines[1]
    }

    async metadata(target:string,signal?:AbortSignal,allowMissing=false):Promise<string> {
        signal?.throwIfAborted()
        const quoted=shellQuote(target)
        const result=await this.run(`${allowMissing?`if test ! -e ${quoted} && test ! -L ${quoted}; then printf 'MISSING'; else `:''}test ! -L ${quoted} && test -f ${quoted} && stat -c '%d:%i:%h:%a:%u:%g:%s:%y:%z' -- ${quoted}${allowMissing?'; fi':''}`,signal)
        signal?.throwIfAborted()
        if(result.exitCode!==0)throw new RemotePathError(result.stderr||'Cannot inspect regular remote file')
        const metadata=result.stdout.trim()
        if(allowMissing&&metadata==='MISSING')return ''
        if(!/^\d+:\d+:\d+:[0-7]+:\d+:\d+:\d+:.+$/.test(metadata)||metadata.includes('\n'))throw new RemotePathError('Invalid remote metadata')
        if(metadata.split(':')[2]!=='1')throw new RemotePathError('Cannot safely write a hard-linked file')
        return metadata
    }


    async resolve (input: string, write = false, signal?: AbortSignal): Promise<string> {
        signal?.throwIfAborted()
        if (!posix.isAbsolute(this.root) || /[\x00-\x1f\x7f]/.test(this.root + input)) throw new RemotePathError('Invalid remote path')
        const target = posix.resolve(this.root, input)
        if (!isRemotePathInsideRoot(this.root, target)) throw new RemotePathError('Path is outside workspaceRoot')
        const check = write ? `test ! -L ${shellQuote(target)} && ` : ''
        const result = await this.run(`${check}realpath -e -- ${shellQuote(this.root)} && realpath -${write ? 'm' : 'e'} -- ${shellQuote(target)}`, signal)
        signal?.throwIfAborted()
        if (result.exitCode !== 0) throw new RemotePathError('Cannot safely resolve remote path (requires realpath); symbolic-link writes are not allowed')
        const lines = result.stdout.replace(/\n$/, '').split('\n')
        if (lines.length !== 2 || lines.some(line => !posix.isAbsolute(line) || /[\x00-\x1f\x7f]/.test(line))) throw new RemotePathError('Invalid remote realpath response')
        if (!isRemotePathInsideRoot(lines[0], lines[1])) throw new RemotePathError('Path escapes workspaceRoot through a symbolic link')
        return lines[1]
    }
}
