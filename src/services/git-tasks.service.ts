import { t } from '../shared/i18n'
import { Injectable } from '@angular/core'
import { dirname, join } from 'path'
import { NotificationsService, PlatformService, LogService } from 'tabby-core'
import { cloneThroughLocalGit, GitIdentity } from '../arw-tree/git/git-bootstrap'
import { gitRelayLocks } from '../arw-tree/git/relay-locks'
import { relayGit } from '../arw-tree/git/git-relay'
import type { RemoteWorkspace } from '../api'
import type { SSHTabComponent } from '../adapters/ssh-compat'
import { TabbyRelayTransport } from '../adapters/transport'

@Injectable()
export class GitTasksService {
    private running = new WeakMap<SSHTabComponent, AbortController>()
    private locks = gitRelayLocks

    constructor (
        private notifications: NotificationsService,
        private platform: PlatformService,
        private logs: LogService,
    ) { }

    busy (tab: SSHTabComponent): boolean { return this.running.has(tab) }

    cancel (tab: SSHTabComponent): void { this.running.get(tab)?.abort() }

    async clone (tab:SSHTabComponent, workspace:RemoteWorkspace, input:GitIdentity & {directory:string},
        signal?:AbortSignal, report?:(message:string)=>void):Promise<string> {
        const session=tab.sshSession
        if(!session?.open)throw new Error(t('SSH 已断开'))
        const configPath=this.platform.getConfigPath()
        if(!configPath)throw new Error(t('无法定位本地 Git 中转目录'))
        const locks=this.locks.get(session)??new Set<string>();this.locks.set(session,locks)
        if(this.busy(tab)||locks.has(workspace.root))throw new Error(t('此工作区已有 Git 中转任务'))
        const controller=new AbortController(),abort=()=>controller.abort()
        signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true})
        this.running.set(tab,controller);locks.add(workspace.root);session.ref()
        const closed=session.willDestroy$.subscribe(abort),timeout=setTimeout(abort,600000)
        try {
            const logger=this.logs.create('arw-git')
            return await cloneThroughLocalGit(new TabbyRelayTransport(session,workspace.root),input,{
                storagePath:join(dirname(configPath),'omw','git-relay'),signal:controller.signal,
                report:message=>{logger.info(message);report?.(message)},
            })
        } finally {
            clearTimeout(timeout);closed.unsubscribe();signal?.removeEventListener('abort',abort)
            this.running.delete(tab);locks.delete(workspace.root);session.unref()
        }
    }

    async run (tab: SSHTabComponent, workspace: RemoteWorkspace|undefined, direction: 'fetch'|'pull'|'push',
        options:{report?:(message:string)=>void;throwOnError?:boolean;quiet?:boolean}={}): Promise<boolean> {
        const fail=(message:string):false=>{
            if(options.throwOnError)throw new Error(message)
            if(!options.quiet)this.notifications.error(t('ARW Git 中转未完成'),message)
            return false
        }
        const session = tab.sshSession
        if (!workspace || !session?.open) {
            return fail(t('请先绑定已连接的远程工作区'))
        }
        const locks = this.locks.get(session) ?? new Set<string>()
        this.locks.set(session, locks)
        if (this.busy(tab) || locks.has(workspace.root)) {
            return fail(t('此工作区已有 Git 中转任务'))
        }
        const configPath = this.platform.getConfigPath()
        if (!configPath) return fail(t('当前平台没有本地配置目录'))
        const controller = new AbortController()
        this.running.set(tab, controller)
        locks.add(workspace.root)
        session.ref()
        const closed = session.willDestroy$.subscribe(() => controller.abort())
        const timeout = setTimeout(() => controller.abort(), 600_000)
        const logger = this.logs.create('arw-git')
        try {
            if(!options.quiet)this.notifications.info(direction === 'fetch' ? t('正在提取上游状态…') : direction === 'pull' ? t('正在拉取上游更新…') : t('正在推送到上游…'))
            const result = await relayGit(direction, new TabbyRelayTransport(session, workspace.root), {
                storagePath: join(dirname(configPath), 'omw', 'git-relay'),
                signal: controller.signal,
                report: message => {logger.info(message);options.report?.(message)},
            })
            if(!options.quiet)this.notifications.info(direction === 'fetch' ? t('已提取上游状态') : direction === 'push' ? t('已推送到上游分支')
                : result?.status === 'up-to-date' ? t('ARW：已是最新提交') : t('已快进拉取'))
            return true
        } catch (error) {
            return fail(controller.signal.aborted
                ? t('操作已取消或超时，请检查远端及上游仓库的实际状态。')
                : error instanceof Error ? error.message : String(error))
        } finally {
            clearTimeout(timeout)
            closed.unsubscribe()
            this.running.delete(tab)
            locks.delete(workspace.root)
            session.unref()
        }
    }
}
