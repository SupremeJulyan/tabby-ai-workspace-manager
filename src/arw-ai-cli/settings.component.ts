import { paneProportions, panePercentage } from '../shared/pane-proportions'
import { paneLayout, type PaneLayout } from '../shared/pane-layout'
import { Component, Injectable } from '@angular/core'
import { ConfigService, ProfilesService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { resumeArguments } from './recovery'
import { aiProxyEnvironment } from './proxy'
import { defaultAgentArguments } from './defaults'
import { configuredShell } from './settings-shell'
import { defaultShell } from './default-shell'
import { t } from '../shared/i18n'
import { selectableShells } from './shell-selection'
import type { AgentShell } from './shell'

@Component({
    selector: 'arw-settings',
    template: `<div class="settings-page"><header><h3>AI Workspace Manager</h3>
      <p>{{ '配置工作区使用的本机 AI CLI、会话参数与代理。' | arwTranslate }}</p></header>
      <section class="settings-section"><h4>{{ '布局' | arwTranslate }}</h4>
        <div class="form-group"><label for="arw-file-layout">{{ '打开文件' | arwTranslate }}</label>
          <select id="arw-file-layout" class="form-control" [(ngModel)]="fileLayout"><option value="tiled">{{ '平铺' | arwTranslate }}</option><option value="stacked">{{ '叠放' | arwTranslate }}</option></select></div>
        <div class="form-group"><label for="arw-ai-layout">{{ 'AI 终端布局' | arwTranslate }}</label>
          <select id="arw-ai-layout" class="form-control" [(ngModel)]="aiLayout"><option value="tiled">{{ '平铺' | arwTranslate }}</option><option value="stacked">{{ '叠放' | arwTranslate }}</option></select></div>
        <div class="arguments-grid"><div class="form-group"><label for="arw-workspace-width">{{ '工作区宽度（%）' | arwTranslate }}</label><input id="arw-workspace-width" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="workspaceWidth"></div><div class="form-group"><label for="arw-ai-width">{{ 'AI 窗格宽度（%）' | arwTranslate }}</label><input id="arw-ai-width" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="aiWidth"></div><div class="form-group"><label for="arw-file-height">{{ '文件区高度（%）' | arwTranslate }}</label><input id="arw-file-height" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="fileHeight"></div><div class="form-group"><label for="arw-terminal-height">{{ '主终端高度（%）' | arwTranslate }}</label><input id="arw-terminal-height" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="terminalHeight"></div></div><small>{{ '左右宽度与上下高度分别合计 100%，修改一项会联动另一项；新开窗格或重新排列时生效。' | arwTranslate }}</small>
        <small>{{ '布局设置对新打开的文件和 AI 终端生效。' | arwTranslate }}</small>
      </section><section class="settings-section"><h4>{{ 'AI 命令' | arwTranslate }}</h4>
      <div class="form-group"><label for="arw-shell">{{ '启动 Shell' | arwTranslate }}</label>
        <select id="arw-shell" class="form-control" [(ngModel)]="shellId"><option value="">{{ '请选择 Tabby 的本地 Shell' | arwTranslate }}</option>
          <option *ngFor="let shell of shells" [value]="shell.id">{{shell.name}} — {{shell.command}}</option></select>
        <small>{{ 'AI CLI 会由所选 Shell 启动并继承其环境变量；不再直接执行 AI 命令。' | arwTranslate }}</small></div>
      <div class="form-group"><label for="arw-command">{{ 'AI CLI 命令或完整路径' | arwTranslate }}</label>
        <input id="arw-command" class="form-control" [(ngModel)]="command" placeholder="codex"></div>
      </section><section class="settings-section"><h4>{{ '会话参数' | arwTranslate }}</h4><div class="arguments-grid"><div class="form-group"><label for="arw-args">{{ '启动参数（每行一个）' | arwTranslate }}</label>
        <textarea id="arw-args" class="form-control" rows="7" [(ngModel)]="argumentsText"></textarea>
        <small>{{ '仅用于新建 AI 终端。' | arwTranslate }}</small></div>
      <div class="form-group"><label for="arw-resume-args">{{ '恢复会话参数（每行一个）' | arwTranslate }}</label>
        <textarea id="arw-resume-args" class="form-control" rows="7" [(ngModel)]="resumeArgumentsText"></textarea>
        <small>{{ '恢复终端时完整使用此处参数，不追加启动参数；留空表示无参数。Codex 示例：resume 和 --last 各占一行；Claude 示例：--continue。' | arwTranslate }}</small></div>
      </div></section><section class="settings-section"><h4>{{ '网络' | arwTranslate }}</h4><div class="form-group"><label for="arw-proxy-url">{{ 'HTTP / HTTPS 代理地址' | arwTranslate }}</label>
        <input id="arw-proxy-url" class="form-control" type="url" [(ngModel)]="proxyUrl" placeholder="http://127.0.0.1:7897">
        <small>{{ '填写完整代理地址，留空继承现有代理环境。仅对新开的 AI 终端生效；ARW 本地转发不经过代理。' | arwTranslate }}</small></div>
      </section><p class="text-danger" role="alert" *ngIf="error">{{error}}</p>
      <p class="settings-note"><small>{{ '远程占位目录的 AGENTS.md 会在 Agent 启动时要求使用 ARW。不同工具的实现和遵循程度可能不同。' | arwTranslate }}</small></p>
      <div class="settings-actions"><button class="btn btn-primary" (click)="save()" [disabled]="saving || !command.trim() || !shellId">{{saving ? ('保存中…' | arwTranslate) : ('保存设置' | arwTranslate)}}</button>
      <span *ngIf="saved" role="status">{{ '已保存' | arwTranslate }}</span></div></div>`,
    styles: [`
      :host{display:block;color:inherit}
      .settings-page{max-width:920px;padding:8px 0 28px}
      header{margin-bottom:26px}h3{font-size:24px;font-weight:500;margin:0 0 10px}header p{font-size:13px;line-height:1.7;opacity:.65;margin:0}
      .settings-section{padding:20px;margin-bottom:18px;border:1px solid #8883;border-radius:10px;background:#88888806;min-width:0}
      h4{font-size:14px;font-weight:600;margin:0 0 18px}
      .form-group{margin:0 0 18px;min-width:0}.form-group:last-child{margin-bottom:0}
      label{display:block;font-size:12px;font-weight:500;margin-bottom:8px}
      .form-control{width:100%;min-width:0;border:1px solid #8884;border-radius:6px;background:#00000012;color:inherit;padding:9px 12px;font-size:13px;box-shadow:none}
      input.form-control{height:38px}textarea.form-control{font-family:var(--terminal-font-family,monospace);font-size:12px;line-height:1.8;resize:vertical;min-height:140px;tab-size:2}
      .form-control:focus{border-color:var(--bs-primary,#579bd5);outline:none;box-shadow:0 0 0 2px #579bd520;background:#00000018}
      .form-control::placeholder{color:inherit;opacity:.35}
      small{display:block;font-size:11px;line-height:1.8;opacity:.6;margin-top:7px}
      .arguments-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.arguments-grid .form-group{margin:0}
      .settings-note{margin:0 2px 20px}.settings-note small{margin:0}
      .settings-actions{display:flex;align-items:center;gap:14px;padding-top:16px;border-top:1px solid #8883}.settings-actions button{min-width:100px;border-radius:6px;font-size:13px;padding:9px 18px}.settings-actions span{font-size:12px;color:#7bc89a}
      .text-danger{font-size:12px;line-height:1.7;padding:10px 12px;border-radius:6px;background:#d9534f10;overflow-wrap:anywhere}
      @media(max-width:900px){.arguments-grid{grid-template-columns:minmax(0,1fr)}.settings-section{padding:16px}}
    `],
})
export class ArwSettingsComponent {
    private proportions=paneProportions(undefined)
    get workspaceWidth():number {return this.proportions.workspaceWidth}
    set workspaceWidth(value:number) {const width=panePercentage(value,this.workspaceWidth);this.proportions.workspaceWidth=width;this.proportions.aiWidth=100-width}
    get aiWidth():number {return this.proportions.aiWidth}
    set aiWidth(value:number) {const width=panePercentage(value,this.aiWidth);this.proportions.aiWidth=width;this.proportions.workspaceWidth=100-width}
    get fileHeight():number {return this.proportions.fileHeight}
    set fileHeight(value:number) {const height=panePercentage(value,this.fileHeight);this.proportions.fileHeight=height;this.proportions.terminalHeight=100-height}
    get terminalHeight():number {return this.proportions.terminalHeight}
    set terminalHeight(value:number) {const height=panePercentage(value,this.terminalHeight);this.proportions.terminalHeight=height;this.proportions.fileHeight=100-height}
    fileLayout: PaneLayout
    aiLayout: PaneLayout
    command: string
    shellId = ''
    shells: AgentShell[] = []
    argumentsText: string
    resumeArgumentsText: string
    proxyUrl: string
    saving = false
    saved = false
    error = ''
    constructor (private config: ConfigService, private profiles: ProfilesService) {
        this.proportions=paneProportions(config.store.omw?.paneProportions)
        const agent = config.store.omw?.agent
        this.shellId=typeof agent?.shell?.id==='string'?agent.shell.id:''
        this.fileLayout=paneLayout(config.store.omw?.fileLayout)
        this.aiLayout=paneLayout(config.store.omw?.aiLayout)
        this.command = agent?.command ?? 'codex'
        this.argumentsText = (agent?.args ?? defaultAgentArguments(this.command)).join('\n')
        this.resumeArgumentsText = (agent?.resumeArgs ?? resumeArguments(this.command,agent?.args??[])).join('\n')
        this.proxyUrl = agent?.proxyUrl ?? ''
        void this.loadShells()
    }
    private async loadShells (): Promise<void> {
        try {
            this.shells=selectableShells(await this.profiles.getProfiles({includeBuiltin:true}) as any[])
            if (!this.shells.some(shell => shell.id === this.shellId)) this.shellId=''
            if (!this.shellId) {
                const preferred=this.config.store.terminal?.profile
                this.shellId=defaultShell(this.shells,preferred)?.id??''
            }
        } catch (error) { this.error=String(error) }
    }
    async save (): Promise<void> {
        if (this.saving || !this.command.trim()) return
        this.saving=true;this.saved=false;this.error=''
        try {
            const shell=this.shells.find(candidate=>candidate.id===this.shellId)
            if (!shell) throw new Error(t('请先在 Tabby 设置 → ai-workspace-manager 中选择启动 Shell'))
            aiProxyEnvironment(this.proxyUrl)
            this.config.store.omw ??= {}
            this.config.store.omw.paneProportions ??= {}
            Object.assign(this.config.store.omw.paneProportions,this.proportions)
            this.config.store.omw.fileLayout=this.fileLayout
            this.config.store.omw.aiLayout=this.aiLayout
            this.config.store.omw.agent ??= { command: 'codex', args: defaultAgentArguments('codex') }
            this.config.store.omw.agent.shell=configuredShell(shell)
            this.config.store.omw.agent.command=this.command.trim()
            this.config.store.omw.agent.args=this.argumentsText.split(/\r?\n/).map(argument=>argument.trim()).filter(Boolean)
            this.config.store.omw.agent.resumeArgs=this.resumeArgumentsText.split(/\r?\n/).map(argument=>argument.trim()).filter(Boolean)
            this.config.store.omw.agent.proxyUrl=this.proxyUrl.trim()
            await this.config.save()
            this.saved=true
        } catch (error) { this.error=String(error) }
        finally { this.saving=false }
    }
}

@Injectable()
export class ArwSettingsTabProvider extends SettingsTabProvider {
    id = 'arw'
    icon = 'code'
    title = 'AI Workspace Manager'
    getComponentType (): typeof ArwSettingsComponent { return ArwSettingsComponent }
}
