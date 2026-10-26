import { registerPaneProportions } from '../shared/pane-proportions'
import { setTerminalCommandMode } from '../shared/terminal-command'
import { t } from '../shared/i18n'
import { Injectable } from '@angular/core'
import { TerminalDecorator, BaseTerminalTabComponent } from 'tabby-terminal'
import { AppService, ConfigService, PlatformService, NotificationsService } from 'tabby-core'
import { dirname, join } from 'node:path'
import { AutomaticAiTiling } from '../arw-ai-cli/tiling'
import { addAiCloseButton } from '../arw-ai-cli/close-button'
import { prepareAiRecovery } from '../arw-ai-cli/recovery'
import { WorkspaceRegistry } from '../services/workspace-registry.service'

@Injectable()
export class WorkspaceTerminalDecorator extends TerminalDecorator {
    private unregisterPaneProportions?:()=>void
    private automaticTiling?:AutomaticAiTiling
    private closeButtons=new Map<BaseTerminalTabComponent<any>,()=>void>()
    constructor (private registry: WorkspaceRegistry, private platform?:PlatformService, private notifications?:NotificationsService, private app?:AppService, private config?:ConfigService) {
        super()
        if(app)this.unregisterPaneProportions=registerPaneProportions(app,()=>this.config?.store.omw?.paneProportions)
        if(app?.tabsChanged$)this.automaticTiling=new AutomaticAiTiling(app,error=>this.notifications?.error(t('AI 终端自动平铺失败'),String(error)))
    }
    ngOnDestroy():void {this.automaticTiling?.dispose();this.unregisterPaneProportions?.()}
    attach (terminal: BaseTerminalTabComponent<any>): void {
        try {
            const configPath=this.platform?.getConfigPath?.()
            const agent=this.config?.store.omw?.agent
            if(configPath)prepareAiRecovery(terminal,join(dirname(configPath),'awm'),join(__dirname,'arw.cjs'),agent?.command?.trim()===terminal.profile?.options?.command?agent?.resumeArgs:undefined)
        } catch(error){this.notifications?.error(t('AI 对话恢复准备失败'),String(error))}
        if(this.app&&!this.closeButtons.has(terminal)){
            const remove=addAiCloseButton(terminal,this.app,error=>this.notifications?.error(t('关闭 AI 终端失败'),String(error)))
            if(remove)this.closeButtons.set(terminal,remove)
        }
        this.registry.register(terminal)
    }
    detach (terminal: BaseTerminalTabComponent<any>): void { setTerminalCommandMode(terminal,false);this.closeButtons.get(terminal)?.();this.closeButtons.delete(terminal);this.registry.unregister(terminal); super.detach(terminal) }
}
