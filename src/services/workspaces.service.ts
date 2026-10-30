import { t } from '../shared/i18n'
import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { randomUUID } from 'crypto'
import { posix } from 'path'
import { NotificationsService, PromptModalComponent } from 'tabby-core'
import type { RemoteWorkspace } from '../api'
import type { SSHTabComponent } from '../adapters/ssh-compat'
import { GitTasksService } from './git-tasks.service'

@Injectable()
export class WorkspacesService {
    private entries = new WeakMap<SSHTabComponent, RemoteWorkspace>()
    private bindings = new WeakMap<SSHTabComponent, { unsubscribe(): void }>()

    constructor (
        private modal: NgbModal,
        private notifications: NotificationsService,
        private tasks: GitTasksService,
    ) { }

    get (tab: SSHTabComponent): RemoteWorkspace|undefined {
        return this.entries.get(tab)
    }

    async bind (tab: SSHTabComponent): Promise<void> {
        if (this.tasks.busy(tab)) { this.notifications.error(t('ARW：请等待 Git 中转完成再切换工作区')); return }
        const session = tab.sshSession
        if (!session?.open) {
            this.notifications.error(t('ARW：请先连接 SSH'))
            return
        }
        const prompt = this.modal.open(PromptModalComponent)
        prompt.componentInstance.prompt = t('ARW：远程工作区绝对路径')
        prompt.componentInstance.value = this.get(tab)?.root ?? '/'
        const result = await prompt.result.catch(() => null)
        if (!result) { return }
        try {
            const root = String(result.value)
            if (!root.startsWith('/') || /[\x00-\x1f\x7f]/.test(root)) {
                throw new Error(t('请输入有效的远程绝对路径'))
            }
            if (this.tasks.busy(tab)) { throw new Error(t('Git 中转运行中，请稍后再绑定')) }
            if (tab.sshSession !== session || !session.open) {
                throw new Error(t('SSH 连接已改变，请重新绑定'))
            }
            const sftp = await session.openSFTP()
            const normalized = posix.normalize(root)
            const info = await sftp.stat(normalized)
            if (!info.isDirectory) { throw new Error(t('工作区必须是目录')) }
            if (this.tasks.busy(tab)) { throw new Error(t('Git 中转运行中，请稍后再绑定')) }
            if (tab.sshSession !== session || !session.open) {
                throw new Error(t('SSH 连接已改变，请重新绑定'))
            }
            const workspace = { id: randomUUID(), root: normalized, host: session.profile.options.host }
            this.bindings.get(tab)?.unsubscribe()
            this.entries.set(tab, workspace)
            const closed = session.willDestroy$.subscribe(() => {
                if (this.entries.get(tab)?.id === workspace.id) { this.entries.delete(tab) }
                this.bindings.delete(tab)
                closed.unsubscribe()
            })
            this.bindings.set(tab, closed)
            this.notifications.info(t('ARW 工作区已绑定'), `${workspace.host}:${workspace.root}`)
        } catch (error) {
            this.notifications.error(t('ARW 工作区绑定失败'), error instanceof Error ? error.message : String(error))
        }
    }
}
