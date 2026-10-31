import { prepareWorkspaceRecovery } from '../shared/workspace-recovery'
import { logOperation } from '../services/operation-log'
import { registerPaneProportions } from '../shared/pane-proportions'
import { setTerminalCommandMode } from '../shared/terminal-command'
import { t } from '../shared/i18n'
import { Injectable } from '@angular/core'
import { TerminalDecorator, BaseTerminalTabComponent } from 'tabby-terminal'
import { AppService, ConfigService, PlatformService, NotificationsService, TabRecoveryService } from 'tabby-core'
import { dirname, join } from 'node:path'
import { AutomaticAiTiling } from '../arw-ai-cli/tiling'
import { addAiCloseButton } from '../arw-ai-cli/close-button'
import { prepareAiRecovery } from '../arw-ai-cli/recovery'
import { WorkspaceRegistry } from '../services/workspace-registry.service'
import { ProjectStore } from '../arw-tree/project.store'

interface RestoredAiForwarding {id:string;release:()=>void}

@Injectable()
export class WorkspaceTerminalDecorator extends TerminalDecorator {
    private unregisterPaneProportions?:()=>void
    private automaticTiling?:AutomaticAiTiling
    private closeButtons=new Map<BaseTerminalTabComponent<any>,()=>void>()
    private aiForwarding=new WeakMap<BaseTerminalTabComponent<any>,RestoredAiForwarding>()
    private aiForwardingAttached=new WeakSet<BaseTerminalTabComponent<any>>()
    private selectionSubscription:{unsubscribe():void}
    constructor (private registry: WorkspaceRegistry, private platform?:PlatformService, private notifications?:NotificationsService, private app?:AppService, private config?:ConfigService, private recovery?:TabRecoveryService, private projects?:ProjectStore) {
        super()
        this.selectionSubscription=registry.selectionChanged.subscribe(({terminal,selection})=>this.restoreAiForwarding(terminal,selection))
        if(app)this.unregisterPaneProportions=registerPaneProportions(app,()=>this.config?.store.omw?.paneProportions)
        if(app?.tabsChanged$)this.automaticTiling=new AutomaticAiTiling(app,error=>logOperation('AI 终端自动平铺',{error:String(error)}))
    }
    ngOnDestroy():void {this.selectionSubscription.unsubscribe();this.automaticTiling?.dispose();this.unregisterPaneProportions?.()}
    private releaseAiForwarding(terminal:BaseTerminalTabComponent<any>):void {
        this.aiForwarding.get(terminal)?.release()
        this.aiForwarding.delete(terminal)
    }
    private restoreAiForwarding(terminal:BaseTerminalTabComponent<any>,selection:import('../services/workspace-registry.service').WorkspaceSelection):void {
        const env=terminal.profile?.options?.env
        if(!env?.ARW_WORKSPACE_ROOT||env.ARW_WORKSPACE_KIND!=='remote'||!selection.workspace||!selection.remote?.open||!this.projects)return
        const project=this.projects.findRemoteProject(selection.workspace,selection.remote)
        if(!project)return
        let held=this.aiForwarding.get(terminal)
        if(held?.id!==project.id){held?.release();held=undefined}
        if(!held){
            held={id:project.id,release:this.projects.retainForAi(project.id)}
            this.aiForwarding.set(terminal,held)
            if(!this.aiForwardingAttached.has(terminal)){
                this.aiForwardingAttached.add(terminal)
                terminal.destroyed$?.subscribe(()=>this.releaseAiForwarding(terminal))
            }
        }
        const workspace={...selection.workspace,sourceWorkspace:selection.workspace,id:project.id}
        void this.projects.open(project,workspace,selection.remote,selection.sourceTerminal??selection.terminal)
            .catch(error=>logOperation('恢复 AI 工作区转发',{root:workspace.root,error:String(error)}))
    }
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
        prepareWorkspaceRecovery(terminal,()=>{
            if(this.recovery&&this.app)void this.recovery.saveTabs(this.app.tabs).catch(error=>logOperation('保存工作区恢复快照',{error:String(error)}))
        })
        this.registry.register(terminal)
    }
    detach (terminal: BaseTerminalTabComponent<any>): void { this.releaseAiForwarding(terminal);setTerminalCommandMode(terminal,false);this.closeButtons.get(terminal)?.();this.closeButtons.delete(terminal);this.registry.unregister(terminal); super.detach(terminal) }
}
