import { t } from '../shared/i18n'
import { Component, Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { resumeArguments } from './recovery'
import { aiProxyEnvironment } from './proxy'
import { AgentEnvironmentSource, parseAgentEnvironment } from './agent-env'
import { defaultAgentArguments } from './defaults'

@Component({
    selector: 'arw-settings',
    template: `<div class="settings-page"><header><h3>ai-workspace-manager</h3>
      <p>{{ '配置工作区使用的本机 AI CLI、会话参数与运行环境。' | arwTranslate }}</p></header>
      <section class="settings-section"><h4>{{ 'AI 命令' | arwTranslate }}</h4>
      <div class="form-group"><label for="arw-command">{{ 'AI CLI 命令或完整路径' | arwTranslate }}</label>
        <input id="arw-command" class="form-control" [(ngModel)]="command" placeholder="codex"></div>
      </section><section class="settings-section"><h4>{{ '会话参数' | arwTranslate }}</h4><div class="arguments-grid"><div class="form-group"><label for="arw-args">{{ '启动参数（每行一个）' | arwTranslate }}</label>
        <textarea id="arw-args" class="form-control" rows="7" [(ngModel)]="argumentsText"></textarea>
        <small>{{ '仅用于新建 AI 终端。' | arwTranslate }}</small></div>
      <div class="form-group"><label for="arw-resume-args">{{ '恢复会话参数（每行一个）' | arwTranslate }}</label>
        <textarea id="arw-resume-args" class="form-control" rows="7" [(ngModel)]="resumeArgumentsText"></textarea>
        <small>{{ '恢复终端时完整使用此处参数，不追加启动参数；留空表示无参数。Codex 示例：resume 和 --last 各占一行；Claude 示例：--continue。' | arwTranslate }}</small></div>
      </div></section><section class="settings-section"><h4>{{ '网络与环境' | arwTranslate }}</h4><div class="form-group"><label for="arw-proxy-url">{{ 'HTTP / HTTPS 代理地址' | arwTranslate }}</label>
        <input id="arw-proxy-url" class="form-control" type="url" [(ngModel)]="proxyUrl" placeholder="http://127.0.0.1:7897">
        <small>{{ '填写完整代理地址，留空继承现有代理环境。仅对新开的 AI 终端生效；ARW 本地转发不经过代理。' | arwTranslate }}</small></div>
      <div class="form-group"><label for="arw-env">{{ 'AI 终端环境变量' | arwTranslate }}</label>
        <div class="environment-field">
          <textarea id="arw-env" class="form-control" rows="4" [style.color]="environmentVisible?'':'transparent'" [style.text-shadow]="environmentVisible?'':'0 0 6px currentColor'" [style.user-select]="environmentVisible?'':'none'" [(ngModel)]="environmentText" placeholder="OPENAI_API_KEY sk_xxxxxxxx&#10;HTTP_PROXY http://127.0.0.1:7897"></textarea>
          <button type="button" class="btn btn-secondary" (click)="toggleEnvironment()"
            [attr.aria-label]="environmentVisible?('隐藏环境变量值' | arwTranslate):('显示环境变量值' | arwTranslate)" [title]="environmentVisible?('隐藏环境变量值' | arwTranslate):('显示环境变量值' | arwTranslate)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path *ngIf="!environmentVisible" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle *ngIf="!environmentVisible" cx="12" cy="12" r="3"/>
              <path *ngIf="environmentVisible" d="M17.9 17.9A10.7 10.7 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.1-5.9M9.9 4.2A10.6 10.6 0 0 1 12 4c7 0 11 7 11 7a20.3 20.3 0 0 1-2.5 3.4M1 1l22 22"/>
            </svg>
</button>
        </div>
        <small>{{ '每行一个 NAME VALUE，中间用空格隔开；值可以包含空格。默认掩码显示，点击眼睛按钮查看。变量值以明文保存在配置中。' | arwTranslate }}</small></div>
      </section><p class="text-danger" role="alert" *ngIf="error">{{error}}</p>
      <p class="settings-note"><small>{{ '远程占位目录的 AGENTS.md 会在 Agent 启动时要求使用 ARW。不同工具的实现和遵循程度可能不同。' | arwTranslate }}</small></p>
      <div class="settings-actions"><button class="btn btn-primary" (click)="save()" [disabled]="saving || !command.trim()">{{saving ? ('保存中…' | arwTranslate) : ('保存设置' | arwTranslate)}}</button>
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
      .environment-field{display:grid;grid-template-columns:minmax(0,1fr) 32px;align-items:center;gap:10px}.environment-field textarea{min-height:130px}.environment-field button{width:32px;height:32px;display:grid;place-items:center;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;opacity:.65}.environment-field button:hover{background:#8882;opacity:1}.environment-field button:focus-visible{outline:2px solid var(--bs-primary,#579bd5);outline-offset:2px}.environment-field button:disabled{opacity:.35}
      .settings-note{margin:0 2px 20px}.settings-note small{margin:0}
      .settings-actions{display:flex;align-items:center;gap:14px;padding-top:16px;border-top:1px solid #8883}.settings-actions button{min-width:100px;border-radius:6px;font-size:13px;padding:9px 18px}.settings-actions span{font-size:12px;color:#7bc89a}
      .text-danger{font-size:12px;line-height:1.7;padding:10px 12px;border-radius:6px;background:#d9534f10;overflow-wrap:anywhere}
      @media(max-width:900px){.arguments-grid{grid-template-columns:minmax(0,1fr)}.settings-section{padding:16px}}
    `],
})
export class ArwSettingsComponent {
    command: string
    argumentsText: string
    resumeArgumentsText: string
    proxyUrl: string
    environmentText: string
    environmentVisible = false
    saving = false
    saved = false
    error = ''
    constructor (private config: ConfigService) {
        const agent = config.store.omw?.agent
        this.command = agent?.command ?? 'codex'
        this.argumentsText = (agent?.args ?? defaultAgentArguments(this.command)).join('\n')
        this.resumeArgumentsText = (agent?.resumeArgs ?? resumeArguments(this.command,agent?.args??[])).join('\n')
        this.proxyUrl = agent?.proxyUrl ?? ''
        this.environmentText = this.renderEnvironment(agent?.env ?? [])
    }
    private renderEnvironment (sources: AgentEnvironmentSource[]): string {
        return sources.map((source:AgentEnvironmentSource) => `${source.name ?? ''} ${source.file ?? source.value ?? ''}`.trim()).join('\n')
    }
    toggleEnvironment (): void {
        this.environmentVisible = !this.environmentVisible
    }
    async save (): Promise<void> {
        if (this.saving || !this.command.trim()) return
        this.saving=true;this.saved=false;this.error=''
        try {
            aiProxyEnvironment(this.proxyUrl)
            this.config.store.omw ??= {}
            this.config.store.omw.agent ??= { command: 'codex', args: defaultAgentArguments('codex') }
            this.config.store.omw.agent.command=this.command.trim()
            this.config.store.omw.agent.args=this.argumentsText.split(/\r?\n/).map(argument=>argument.trim()).filter(Boolean)
            this.config.store.omw.agent.resumeArgs=this.resumeArgumentsText.split(/\r?\n/).map(argument=>argument.trim()).filter(Boolean)
            this.config.store.omw.agent.proxyUrl=this.proxyUrl.trim()
            const env=parseAgentEnvironment(this.environmentText)
            this.config.store.omw.agent.env=env
            await this.config.save()
            this.environmentText=this.renderEnvironment(env)
            this.environmentVisible=false
            this.saved=true
        } catch (error) { this.error=String(error) }
        finally { this.saving=false }
    }
}

@Injectable()
export class ArwSettingsTabProvider extends SettingsTabProvider {
    id = 'arw'
    icon = 'code'
    title = 'ai-workspace-manager'
    getComponentType (): typeof ArwSettingsComponent { return ArwSettingsComponent }
}
