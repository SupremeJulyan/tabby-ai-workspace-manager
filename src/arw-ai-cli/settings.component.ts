import { remoteFileLimit } from '../arw-tree/remote-file-limit'
import { paneProportions, panePercentage } from '../shared/pane-proportions'
import { paneLayout, type PaneLayout } from '../shared/pane-layout'
import { Component, Injectable } from '@angular/core'
import { ConfigService, ProfilesService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { aiProxyEnvironment } from './proxy'
import { t } from '../shared/i18n'
import { aiName, configuredAiCommands, createAiCommand, parseAiCommand } from './ai-command'
import { configuredShell } from './settings-shell'
import { defaultShell } from './default-shell'
import { sameShell, selectableShells } from './shell-selection'
import type { AgentShell } from './shell'

@Component({
    selector: 'arw-settings',
    template: `<div class="settings-page"><header><h3>AI Workspace Manager</h3>
      <p>{{ '配置工作区可使用的 AI 启动命令、恢复命令与代理；默认提供 Codex 和 Claude，首项作为默认 AI。' | arwTranslate }}</p></header>
      <section class="settings-section"><h4>{{ '布局' | arwTranslate }}</h4>
        <div class="form-group"><label class="small-screen-toggle" for="arw-small-screen"><input id="arw-small-screen" type="checkbox" [(ngModel)]="smallScreen"> {{ '小屏模式' | arwTranslate }}</label><small>{{ '左侧栏与文件、主终端、AI 终端分为三层，每层占满内容区。点击顶部三个按钮切换，保存后立即生效。' | arwTranslate }}</small></div>
        <div class="form-group"><label for="arw-file-layout">{{ '打开文件' | arwTranslate }}</label>
          <select id="arw-file-layout" class="form-control" [(ngModel)]="fileLayout"><option value="tiled">{{ '平铺' | arwTranslate }}</option><option value="stacked">{{ '叠放' | arwTranslate }}</option></select></div>
        <div class="form-group"><label for="arw-ai-layout">{{ 'AI 终端布局' | arwTranslate }}</label>
          <select id="arw-ai-layout" class="form-control" [(ngModel)]="aiLayout"><option value="tiled">{{ '平铺' | arwTranslate }}</option><option value="stacked">{{ '叠放' | arwTranslate }}</option></select></div>
        <div class="form-group"><label for="arw-remote-file-limit">{{ '最多打开的远程文件数' | arwTranslate }}</label><input id="arw-remote-file-limit" type="number" min="1" step="1" class="form-control" [(ngModel)]="remoteFileLimit"><small>{{ '默认 10 个，超过后关闭最早打开的远程文件；未保存的修改会先确认。取消关闭时暂时保留超限文件。保存后在下次打开文件时生效。' | arwTranslate }}</small></div>
        <div class="arguments-grid"><div class="form-group"><label for="arw-workspace-width">{{ '工作区宽度（%）' | arwTranslate }}</label><input id="arw-workspace-width" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="workspaceWidth"></div><div class="form-group"><label for="arw-ai-width">{{ 'AI 窗格宽度（%）' | arwTranslate }}</label><input id="arw-ai-width" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="aiWidth"></div><div class="form-group"><label for="arw-file-height">{{ '文件区高度（%）' | arwTranslate }}</label><input id="arw-file-height" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="fileHeight"></div><div class="form-group"><label for="arw-terminal-height">{{ '主终端高度（%）' | arwTranslate }}</label><input id="arw-terminal-height" type="number" min="1" max="99" step="1" class="form-control" [(ngModel)]="terminalHeight"></div></div><small>{{ '左右宽度与上下高度分别合计 100%，修改一项会联动另一项；新开窗格或重新排列时生效。' | arwTranslate }}</small>
        <small>{{ '布局设置对新打开的文件和 AI 终端生效。' | arwTranslate }}</small>
      </section><section class="settings-section"><div class="section-heading"><h4>{{ 'AI 命令' | arwTranslate }}</h4>
        <button type="button" class="btn btn-secondary btn-sm" (click)="addAi()">{{ '添加 AI' | arwTranslate }}</button></div>
      <div class="form-group"><label for="arw-ai-shell">{{ '启动 Shell' | arwTranslate }}</label>
        <select id="arw-ai-shell" class="form-control" [(ngModel)]="shellId" [disabled]="!shells.length"><option value="">{{ '请选择 Tabby 的本地 Shell' | arwTranslate }}</option>
          <option *ngFor="let shell of shells" [value]="shell.id">{{shell.name}} — {{shell.command}}</option></select>
        <small>{{ '所有 AI CLI 共用此 Shell；从 WSL 终端启动时仍沿用该 WSL 终端的 Shell。' | arwTranslate }}</small></div>
      <div class="ai-command" *ngFor="let agent of agents; let index=index">
        <div class="ai-command-heading"><strong>{{ agentName(agent.command) || (('AI' | arwTranslate) + ' ' + (index + 1)) }}</strong>
          <button type="button" class="btn btn-link text-danger" (click)="removeAi(index)">{{ '移除' | arwTranslate }}</button></div>
        <div class="form-group"><label [for]="'arw-command-' + index">{{ '启动命令' | arwTranslate }}</label>
          <input [id]="'arw-command-' + index" class="form-control" [(ngModel)]="agent.command" placeholder="/usr/bin/codex --no-daemon">
          <small>{{ '填写二进制命令或路径及参数；AI 名称从二进制文件名自动解析。' | arwTranslate }}</small></div>
        <div class="arguments-grid">
          <div class="form-group"><label [for]="'arw-resume-' + index">{{ '恢复命令' | arwTranslate }}</label>
            <input [id]="'arw-resume-' + index" class="form-control" [(ngModel)]="agent.resumeCommand" placeholder="/usr/bin/codex resume --last">
            <small>{{ '填写完整恢复命令；留空时按 AI 类型自动推断。命令名可从 PATH 查找。' | arwTranslate }}</small></div>
          <div class="form-group"><label [for]="'arw-proxy-' + index">{{ '代理' | arwTranslate }}</label>
            <input [id]="'arw-proxy-' + index" class="form-control" type="url" [(ngModel)]="agent.proxyUrl" placeholder="http://127.0.0.1:7897">
            <small>{{ '留空继承现有代理环境。仅对新开的 AI 终端生效；ARW 本地转发不经过代理。' | arwTranslate }}</small></div>
        </div>
      </div>
      <p class="empty-ai" *ngIf="!agents.length">{{ '添加一条 AI 启动命令后，可在工作区中选择使用的 AI。' | arwTranslate }}</p>
      </section><p class="text-danger" role="alert" *ngIf="error">{{error}}</p>
      <p class="settings-note"><small>{{ '远程占位目录的 AGENTS.md 会在 Agent 启动时要求使用 ARW。不同工具的实现和遵循程度可能不同。' | arwTranslate }}</small></p>
      <div class="settings-actions"><button class="btn btn-primary" (click)="save()" [disabled]="saving || !shellId">{{saving ? ('保存中…' | arwTranslate) : ('保存设置' | arwTranslate)}}</button>
      <span *ngIf="saved" role="status">{{ '已保存' | arwTranslate }}</span></div></div>`,
    styles: [`
      :host{display:block;color:inherit}
      .small-screen-toggle{display:flex;align-items:center;gap:8px}
      .settings-page{max-width:920px;padding:8px 0 28px}
      header{margin-bottom:26px}h3{font-size:24px;font-weight:500;margin:0 0 10px}header p{font-size:13px;line-height:1.7;opacity:.65;margin:0}
      .settings-section{padding:20px;margin-bottom:18px;border:1px solid #8883;border-radius:10px;background:#88888806;min-width:0}
      .section-heading,.ai-command-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
      h4{font-size:14px;font-weight:600;margin:0 0 18px}.section-heading h4{margin:0}
      .ai-command{padding:16px;margin-top:16px;border:1px solid #8883;border-radius:8px}.ai-command-heading{margin-bottom:16px}.ai-command-heading strong{font-size:12px}.ai-command-heading button{padding:0 4px;font-size:12px}
      .form-group{margin:0 0 18px;min-width:0}.form-group:last-child{margin-bottom:0}
      label{display:block;font-size:12px;font-weight:500;margin-bottom:8px}
      .form-control{width:100%;min-width:0;border:1px solid #8884;border-radius:6px;background:#00000012;color:inherit;padding:9px 12px;font-size:13px;box-shadow:none}
      input.form-control{height:38px}
      .form-control:focus{border-color:var(--bs-primary,#579bd5);outline:none;box-shadow:0 0 0 2px #579bd520;background:#00000018}
      .form-control::placeholder{color:inherit;opacity:.35}
      small{display:block;font-size:11px;line-height:1.8;opacity:.6;margin-top:7px}
      .arguments-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.arguments-grid .form-group{margin:0}
      .empty-ai{font-size:12px;opacity:.6;margin:18px 0 0}
      .settings-note{margin:0 2px 20px}.settings-note small{margin:0}
      .settings-actions{display:flex;align-items:center;gap:14px;padding-top:16px;border-top:1px solid #8883}.settings-actions button{min-width:100px;border-radius:6px;font-size:13px;padding:9px 18px}.settings-actions span{font-size:12px;color:#7bc89a}
      .text-danger{font-size:12px;line-height:1.7;padding:10px 12px;border-radius:6px;background:#d9534f10;overflow-wrap:anywhere}
      @media(max-width:900px){.arguments-grid{grid-template-columns:minmax(0,1fr)}.settings-section{padding:16px}.ai-command{padding:12px}}
    `],
})
export class ArwSettingsComponent {
    private proportions=paneProportions(undefined)
    private shellsReady:Promise<void>=Promise.resolve()
    get workspaceWidth():number {return this.proportions.workspaceWidth}
    set workspaceWidth(value:number) {const width=panePercentage(value,this.workspaceWidth);this.proportions.workspaceWidth=width;this.proportions.aiWidth=100-width}
    get aiWidth():number {return this.proportions.aiWidth}
    set aiWidth(value:number) {const width=panePercentage(value,this.aiWidth);this.proportions.aiWidth=width;this.proportions.workspaceWidth=100-width}
    get fileHeight():number {return this.proportions.fileHeight}
    set fileHeight(value:number) {const height=panePercentage(value,this.fileHeight);this.proportions.fileHeight=height;this.proportions.terminalHeight=100-height}
    get terminalHeight():number {return this.proportions.terminalHeight}
    set terminalHeight(value:number) {const height=panePercentage(value,this.terminalHeight);this.proportions.terminalHeight=height;this.proportions.fileHeight=100-height}
    agents=configuredAiCommands(this.config.store.omw)
    shellId=''
    shells:AgentShell[]=[]
    smallScreen=false
    remoteFileLimit=10
    fileLayout: PaneLayout
    aiLayout: PaneLayout
    saving = false
    saved = false
    error = ''
    constructor (private config: ConfigService, private profiles:ProfilesService) {
        this.smallScreen=config.store.omw?.smallScreen===true
        this.proportions=paneProportions(config.store.omw?.paneProportions)
        this.remoteFileLimit=remoteFileLimit(config.store.omw?.remoteFileLimit)
        this.fileLayout=paneLayout(config.store.omw?.fileLayout??'stacked')
        this.aiLayout=paneLayout(config.store.omw?.aiLayout)
        const savedShell=config.store.omw?.aiShell??config.store.omw?.agent?.shell
        this.shellId=typeof savedShell?.id==='string'?savedShell.id:''
        this.shellsReady=this.loadShells(savedShell)
    }
    private async loadShells(saved:unknown):Promise<void>{
        try{
            this.shells=selectableShells(await this.profiles.getProfiles({includeBuiltin:true}) as any[])
            const savedShell=saved&&typeof saved==='object'?saved as Partial<AgentShell>:undefined
            const selected=this.shells.find(shell=>shell.id===this.shellId)
                ??this.shells.find(shell=>sameShell(savedShell,shell))
                ??defaultShell(this.shells,this.config.store.terminal?.profile)
                ??this.shells[0]
            this.shellId=selected?.id??''
        }catch(error){this.shellId='';this.error=String(error)}
    }
    agentName(command:string):string {
        try{return aiName(command)}catch{return ''}
    }
    addAi():void {
        this.agents=[...this.agents,createAiCommand()]
        this.saved=false
    }
    removeAi(index:number):void {
        this.agents=this.agents.filter((_,position)=>position!==index)
        this.saved=false
    }
    async save (): Promise<void> {
        if (this.saving) return
        this.saving=true;this.saved=false;this.error=''
        try {
            await this.shellsReady
            const shell=this.shells.find(candidate=>candidate.id===this.shellId)
            if(!shell)throw new Error(t('请先在 Tabby 设置 → ai-workspace-manager 中选择启动 Shell'))
            const agents=this.agents.map(agent=>({...agent,command:agent.command.trim(),resumeCommand:agent.resumeCommand.trim(),proxyUrl:agent.proxyUrl.trim()}))
            for(const agent of agents){
                parseAiCommand(agent.command)
                if(agent.resumeCommand)parseAiCommand(agent.resumeCommand)
                aiProxyEnvironment(agent.proxyUrl)
            }
            this.config.store.omw ??= {}
            this.config.store.omw.aiShell=configuredShell(shell)
            this.config.store.omw.paneProportions ??= {}
            Object.assign(this.config.store.omw.paneProportions,this.proportions)
            this.config.store.omw.smallScreen=this.smallScreen
            this.config.store.omw.remoteFileLimit=remoteFileLimit(this.remoteFileLimit)
            this.config.store.omw.fileLayout=this.fileLayout
            this.config.store.omw.aiLayout=this.aiLayout
            this.config.store.omw.agents=agents.map(({id,command,resumeCommand,proxyUrl})=>({id,command,resumeCommand,proxyUrl}))
            this.config.store.omw.agentsConfigured=true
            this.config.store.omw.agent=null
            this.agents=agents
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
