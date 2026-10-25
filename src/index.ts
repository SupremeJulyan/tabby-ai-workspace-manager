import { setArwLocale } from './shared/i18n'
import { ArwTranslatePipe } from './shared/translate.pipe'
import { t } from './shared/i18n'
import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { SettingsTabProvider } from 'tabby-settings'
import { ArwSettingsComponent, ArwSettingsTabProvider } from './arw-ai-cli/settings.component'
import { NotificationsService, TabContextMenuItemProvider, ConfigProvider, ToolbarButtonProvider, ConfigService, PlatformService, LocaleService } from 'tabby-core'
import { dirname, join } from 'node:path'
import { TerminalDecorator } from 'tabby-terminal'
import { ForwardingService } from './arw-cli/forwarding.service'
import { WorkspaceTerminalDecorator } from './providers/workspace.decorator'
import { WorkspaceRegistry } from './services/workspace-registry.service'
import { ArwTreeComponent } from './arw-tree/tree.component'
import { ArwPreviewComponent } from './arw-tree/preview.component'
import { ArwEditorComponent } from './arw-tree/editor.component'
import { SidebarService } from './arw-tree/sidebar.service'
import { AiLauncherService } from './arw-ai-cli/launcher.service'
import { ArwConfigProvider } from './config'
import { WorkspaceToolbarProvider } from './providers/workspace-toolbar.provider'
import { requireSshCompatibility } from './adapters/ssh-compat'
import { ArwContextMenuProvider } from './providers/context-menu.provider'
import { WorkspacesService } from './services/workspaces.service'
import { GitTasksService } from './services/git-tasks.service'
import { installUserCli, attachCliUninstall } from './arw-ai-cli/cli-lifecycle'
import { ProjectStore } from './arw-tree/project.store'

@NgModule({
    imports:[CommonModule,FormsModule],
    declarations:[ArwTreeComponent,ArwEditorComponent,ArwSettingsComponent,ArwPreviewComponent,ArwTranslatePipe],
    providers: [
        WorkspacesService,
        GitTasksService,
        { provide: TabContextMenuItemProvider, useClass: ArwContextMenuProvider, multi: true },
        ForwardingService,
        { provide: TerminalDecorator, useClass: WorkspaceTerminalDecorator, multi: true },
        WorkspaceRegistry, SidebarService, AiLauncherService,
        { provide: ProjectStore, useFactory: (config:ConfigService, platform?:PlatformService, notifications?:NotificationsService) => {
            const configPath=platform?.getConfigPath()
            const store=new ProjectStore(config,configPath?join(dirname(configPath), 'omw', 'workspaces.json'):undefined)
            void (platform?store.restoreLocal():store.syncCatalog()).catch(error=>notifications?.error(t('ARW 工作区转发恢复失败'),String(error)))
            return store
        }, deps: [ConfigService,PlatformService,NotificationsService] },
        { provide:ConfigProvider,useClass:ArwConfigProvider,multi:true },
        { provide:ToolbarButtonProvider,useClass:WorkspaceToolbarProvider,multi:true },
        { provide:SettingsTabProvider,useClass:ArwSettingsTabProvider,multi:true },
    ],
})
export default class ArwModule {
    private detachCliUninstall?:()=>void
    private localeSubscription?:{unsubscribe():void}
    ngOnDestroy():void {this.localeSubscription?.unsubscribe();this.detachCliUninstall?.()}
    constructor (notifications: NotificationsService, sidebar:SidebarService, locale:LocaleService, platform?:PlatformService) {
        const cliSource=join(__dirname,'arw.cjs')
        if(platform)this.detachCliUninstall=attachCliUninstall(platform,cliSource)
        void installUserCli(cliSource).catch(error=>notifications.error('ARW CLI',String(error)))
        setArwLocale(locale.getLocale())
        this.localeSubscription=locale.localeChanged$.subscribe(value=>setArwLocale(value))
        sidebar.install()
        try { requireSshCompatibility() } catch (error) {
            notifications.error(t('ARW SSH 接口不兼容'), error instanceof Error ? error.message : String(error))
        }
    }
}
