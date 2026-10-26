import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { SFTPSession, SFTPFileHandle } from 'tabby-ssh/typings/session/sftp'
import { RemotePathGuard } from '../security/remote-path'
import { text } from '../arw-cli/operations'

// SFTP v3 open flags, as used by russh and Tabby's SFTPSession.
const READ = 1, WRITE = 2, CREATE = 8, TRUNCATE = 16
interface Transfer {
    file: SFTPFileHandle
    direction: 'read'|'write'
    sftp: SFTPSession
    path: string
    input: string
    temporary?: string
    busy: boolean
    timer?: ReturnType<typeof setTimeout>
}
const missing = (error: unknown) => /no such file|not found|ENOENT/i.test(String(error))

/** Mirrors Tabby SFTP: bounded handle reads/writes and temporary upload + rename.
 * Only chunk payloads cross the local CLI bridge; no local paths reach Tabby.
 */
export function sftpCopy (open: () => Promise<SFTPSession>, guard: RemotePathGuard) {
    const transfers = new Map<string, Transfer>()
    let connection: Promise<SFTPSession>|undefined
    const session = () => connection ??= open().catch(error => { connection = undefined; throw error })
    const dispose = async (id: string) => {
        const transfer = transfers.get(id)
        if (!transfer) return
        transfers.delete(id)
        clearTimeout(transfer.timer)
        try { await transfer.file.close() }
        finally { if (transfer.temporary) await transfer.sftp.unlink(transfer.temporary).catch(() => undefined) }
    }
    const touch = (id: string, transfer: Transfer) => {
        clearTimeout(transfer.timer)
        transfer.timer = setTimeout(() => { void dispose(id).catch(() => undefined) }, 120000)
        transfer.timer.unref?.()
    }
    let bound = false
    return async (args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
        signal.throwIfAborted()
        if (!bound) {
            bound = true
            signal.addEventListener('abort', () => { for (const id of transfers.keys()) void dispose(id).catch(() => undefined) }, {once: true})
        }
        const action = text(args.action, 'action')
        if (['read', 'write', 'close', 'cancel'].includes(action)) {
            const id = text(args.transferId, 'transferId'), transfer = transfers.get(id)
            if (!transfer) throw new Error('Copy transfer expired or unavailable')
            if (transfer.busy) throw new Error('Copy transfer already has an operation in progress')
            transfer.busy = true
            clearTimeout(transfer.timer)
            try {
                if (action === 'read' && transfer.direction === 'read') {
                    const bytes = await transfer.file.read()
                    signal.throwIfAborted()
                    if (!bytes.length) await dispose(id)
                    return {data: Buffer.from(bytes).toString('base64'), eof: !bytes.length}
                }
                if (action === 'write' && transfer.direction === 'write') {
                    const data = text(args.data, 'data')
                    if (!data.length || data.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid copy chunk (maximum 256 KiB)')
                    const bytes = Buffer.from(data, 'base64')
                    if (bytes.length > 256 * 1024) throw new Error('Copy chunk exceeds 256 KiB')
                    await transfer.file.write(bytes)
                    signal.throwIfAborted()
                    return {bytes: bytes.length}
                }
                if (action === 'close') {
                    await transfer.file.close()
                    signal.throwIfAborted()
                    if (transfer.temporary) {
                        if (await guard.resolve(transfer.input, true, signal) !== transfer.path) throw new Error('Copy target changed')
                        const existing = await transfer.sftp.stat(transfer.path).catch(error => { if (missing(error)) return undefined; throw error })
                        if (existing) throw new Error('Copy target already exists')
                        await transfer.sftp.rename(transfer.temporary, transfer.path)
                        transfer.temporary = undefined
                    }
                    await dispose(id)
                    return {closed: true}
                }
                if (action === 'cancel') { await dispose(id); return {cancelled: true} }
                throw new Error('Invalid action for copy transfer')
            } catch (error) { await dispose(id).catch(() => undefined); throw error }
            finally { transfer.busy = false; if (transfers.has(id)) touch(id, transfer) }
        }
        if (!['stat', 'mkdir', 'open-read', 'open-write'].includes(action)) throw new Error('Unsupported copy action')
        const input = text(args.path, 'path')
        // Download/stat may read outside the root; uploads still enforce the boundary.
        const path = action==='stat'||action==='open-read'
            ?await guard.resolveRead(input,signal,action==='stat')
            :await guard.resolve(input,true,signal)
        const sftp = await session()
        const info = await sftp.stat(path).catch(error => { if (missing(error)) return undefined; throw error })
        signal.throwIfAborted()
        if (action === 'stat') return info ? {exists: true, directory: info.isDirectory, size: info.size} : {exists: false}
        if (action === 'mkdir') {
            if (info) throw new Error('Copy target already exists')
            await sftp.mkdir(path)
            return {created: true}
        }
        if (transfers.size >= 16) throw new Error('Too many active copy transfers')
        if (action === 'open-write' && info) throw new Error('Copy target already exists')
        if (action === 'open-read' && (!info || info.isDirectory)) throw new Error('Copy source is not a regular file')
        const temporary = action === 'open-write' ? posix.join(posix.dirname(path), '.arw-copy-' + randomUUID()) : undefined
        const file = await sftp.open(temporary ?? path, temporary ? WRITE | CREATE | TRUNCATE : READ)
        const id = randomUUID(), transfer: Transfer = {file, direction: temporary ? 'write' : 'read', path, input, temporary, sftp, busy: false}
        transfers.set(id, transfer)
        try {
            if (temporary) await sftp.chmod(temporary, 0o600)
            signal.throwIfAborted()
            touch(id, transfer)
            return {transferId: id}
        } catch (error) { await dispose(id).catch(() => undefined); throw error }
    }
}
