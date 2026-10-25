import { t } from '../shared/i18n'
import { open } from 'fs/promises'
import { OPEN_CREATE, OPEN_READ, OPEN_TRUNCATE, OPEN_WRITE } from 'russh'
import type { SSHSession } from './ssh-compat'
import { executeChannel, type ExecOptions } from '../shared/exec-channel'
import { RelayTransport } from '../arw-tree/git/git-relay'


/** Uses the already authenticated Tabby session, including its jump hosts. */
export class TabbyRelayTransport implements RelayTransport {
    constructor (private session: SSHSession, public root: string) { }

    async run (command: string, signal?: AbortSignal, options: ExecOptions = {}) {
        signal?.throwIfAborted()
        if (!this.session.open) { throw new Error(t('SSH 连接已关闭')) }
        const client = this.session.ssh
        if (!('openSessionChannel' in client)) { throw new Error(t('SSH 尚未认证')) }
        try {
            const channel = await client.activateChannel(await client.openSessionChannel())
            return await executeChannel(channel, command, this.root, { ...options, signal })
        } catch(error){
            if(/\bSendError\b/.test(error instanceof Error?error.message:String(error)))throw new Error(t('SSH 通道已失效（SendError），请检查来源 SSH 终端的连接。命令没有自动重试。'),{cause:error})
            throw error
        }
    }

    async download (remote: string, local: string, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted()
        const sftp = await this.session.openSFTP()
        const source = await sftp.open(remote, OPEN_READ)
        try {
            const target = await open(local, 'wx', 0o600)
            try {
                while (true) {
                    signal?.throwIfAborted()
                    const chunk = await source.read()
                    if (!chunk.length) { break }
                    let offset = 0
                    while (offset < chunk.length) {
                        const { bytesWritten } = await target.write(chunk, offset, chunk.length - offset)
                        if (!bytesWritten) { throw new Error(t('本地文件写入未完成')) }
                        offset += bytesWritten
                    }
                }
            } finally { await target.close() }
        } finally { await source.close() }
    }

    async upload (local: string, remote: string, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted()
        const source = await open(local, 'r')
        try {
            const sftp = await this.session.openSFTP()
            const target = await sftp.open(remote, OPEN_WRITE | OPEN_CREATE | OPEN_TRUNCATE)
            try {
                await sftp.chmod(remote, 0o600)
                const buffer = Buffer.alloc(256 * 1024)
                while (true) {
                    signal?.throwIfAborted()
                    const { bytesRead } = await source.read(buffer)
                    if (!bytesRead) { break }
                    await target.write(buffer.subarray(0, bytesRead))
                }
            } finally { await target.close() }
        } finally { await source.close() }
    }

    async remove (remote: string): Promise<void> {
        const sftp = await this.session.openSFTP()
        try { await sftp.unlink(remote) } catch (error) {
            if (!/no such file|not found/i.test(String(error))) { throw error }
        }
    }
}
