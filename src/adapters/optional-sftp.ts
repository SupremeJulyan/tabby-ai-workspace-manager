import { t } from '../shared/i18n'
import type { SSHSession } from './ssh-compat'

type Sftp = Awaited<ReturnType<SSHSession['openSFTP']>>
const probes = new WeakMap<SSHSession, {client:SSHSession['ssh']; pending:Promise<Sftp|undefined>}>()

export function optionalSftp (session:SSHSession):Promise<Sftp|undefined> {
    if (!session.open) return Promise.reject(new Error(t('SSH 已断开')))
    const client = session.ssh
    const cached = probes.get(session)
    if (cached && cached.client === client) return cached.pending
    const pending = Promise.resolve().then(async () => {
        let timer:ReturnType<typeof setTimeout>|undefined
        try {
            const sftp=await Promise.race([
                session.openSFTP(),
                new Promise<never>((_resolve,reject) => {timer=setTimeout(()=>reject(new Error(t('SFTP 初始化超时'))),10000)}),
            ])
            if(!session.open||session.ssh!==client)throw new Error(t('SSH 会话已变化'))
            return sftp
        } catch {
            if (!session.open || session.ssh !== client) throw new Error(t('SSH 会话已断开或重连，请刷新目录'))
            return undefined
        } finally {clearTimeout(timer)}
    })
    probes.set(session,{client,pending})
    void pending.catch(()=>{if(probes.get(session)?.pending===pending)probes.delete(session)})
    return pending
}
