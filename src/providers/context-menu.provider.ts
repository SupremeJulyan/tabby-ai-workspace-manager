import { t } from '../shared/i18n'
import { Injectable } from '@angular/core'
import { BaseTabComponent, MenuItemOptions, TabContextMenuItemProvider } from 'tabby-core'
import { isSshTab } from '../adapters/ssh-compat'
import { WorkspacesService } from '../services/workspaces.service'
import { GitTasksService } from '../services/git-tasks.service'

@Injectable()
export class ArwContextMenuProvider extends TabContextMenuItemProvider {
    weight = 20

    constructor (private workspaces: WorkspacesService, private tasks: GitTasksService) { super() }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!isSshTab(tab)) { return [] }
        const items: MenuItemOptions[] = [{
            label: this.workspaces.get(tab) ? t('ARW：切换远程工作区') : t('ARW：绑定远程工作区'),
            click: () => this.workspaces.bind(tab),
        }]
        if (this.tasks.busy(tab)) {
            items.push({ label: t('ARW：取消 Git 中转'), click: () => this.tasks.cancel(tab) })
        } else if (this.workspaces.get(tab)) {
            items.push(
                { label: t('ARW Git：通过本地拉取（仅快进）'), click: () => this.tasks.run(tab, this.workspaces.get(tab), 'pull') },
                { label: t('ARW Git：通过本地推送已有提交'), click: () => this.tasks.run(tab, this.workspaces.get(tab), 'push') },
            )
        }
        return items
    }
}
