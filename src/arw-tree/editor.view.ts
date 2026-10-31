import { FILE_TOOLBAR_STYLES } from './file-toolbar.view'
import { MARKDOWN_STYLES } from './preview/markdown.view'
import { scaleTypography } from './fonts'
import { TEXT_SEARCH_TEMPLATE, TEXT_SEARCH_STYLES } from './text-search.view'

export const EDITOR_TEMPLATE = `
<header><div class="file-heading"><strong>{{filePath}}</strong><small>{{workspace?.label}}</small></div>
  <button *ngIf="!isDiff" class="file-icon-button" [title]="'查找' | arwTranslate" [attr.aria-label]="'查找' | arwTranslate" (click)="search.open()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"/></svg></button>
  <button *ngIf="!isDiff && !readonly" class="file-icon-button" [title]="'替换' | arwTranslate" [attr.aria-label]="'替换' | arwTranslate" (click)="search.open(true)" [disabled]="!search.canReplace()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg></button>
  <button *ngIf="!isDiff" class="file-icon-button" [title]="(saving ? '保存中…' : '保存') | arwTranslate" [attr.aria-label]="(saving ? '保存中…' : '保存') | arwTranslate" [disabled]="readonly || loading || saving || !dirty || saveIssue" (click)="save()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/></svg></button>
  <button *ngIf="isMarkdown" class="file-icon-button" [title]="(markdownPreview ? '源码' : '预览') | arwTranslate" [attr.aria-label]="(markdownPreview ? '源码' : '预览') | arwTranslate" (click)="toggleMarkdown()" [disabled]="loading || saving"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></svg></button>
</header>
${TEXT_SEARCH_TEMPLATE}
<div class="error" *ngIf="saveIssue as issue" role="alert">
  {{issue.message}}
  <button class="btn btn-sm btn-secondary" [disabled]="saving || loading || issue.busy" (click)="verifySave()">{{'核对远端文件' | arwTranslate}}</button>
  <button class="btn btn-sm btn-secondary" [disabled]="saving || loading || issue.busy" (click)="reloadSave()">{{'重新加载' | arwTranslate}}</button>
  <button class="btn btn-sm btn-warning" [disabled]="readonly || saving || loading || issue.busy" (click)="retrySave()">{{'再次保存' | arwTranslate}}</button>
</div>
<div class="error" *ngIf="error" role="alert">{{error}}</div>
<div class="connection-status" *ngIf="waitingForConnection" role="status">
  {{connectionStatus || ('等待原 SSH 会话' | arwTranslate)}}

</div>
<ng-container *ngIf="isDiff && diff && !error">
  <pre class="diff-description" *ngIf="diffDescription">{{diffDescription}}</pre>
  <div class="diff-toolbar"><span class="comparison-label">{{diffLabel || (diffStaged ? ('HEAD → 暂存区' | arwTranslate) : ('暂存区 → 工作区' | arwTranslate))}}</span><span class="diff-added">+{{diff.added}}</span><span class="diff-removed">−{{diff.removed}}</span><span class="toolbar-spacer"></span>
    <div class="view-switch" role="group" [attr.aria-label]="'差异显示方式' | arwTranslate"><button (click)="diffMode='split'" [class.selected]="diffMode==='split'" [attr.aria-pressed]="diffMode==='split'">{{ '并排' | arwTranslate }}</button><button (click)="diffMode='unified'" [class.selected]="diffMode==='unified'" [attr.aria-pressed]="diffMode==='unified'">{{ '统一' | arwTranslate }}</button></div>
    <button (click)="previousHunk()" [disabled]="!diff.hunks.length" [attr.aria-label]="'上一个差异' | arwTranslate" [title]="'上一个差异' | arwTranslate">↑</button><span class="hunk-position">{{activeHun}}< 0 ? '全部' : (activeHunk+1)}} / {{diff.hunks.length}}</span><button (click)="nextHunk()" [disabled]="!diff.hunks.length" [attr.aria-label]="'下一个差异' | arwTranslate" [title]="'下一个差异' | arwTranslate">↓</button><button *ngIf="activeHunk>=0" (click)="activeHunk=-1">{{ '显示全部' | arwTranslate }}</button>
  </div>
  <div class="diff-scroll" tabindex="0" [attr.aria-label]="'文件差异' | arwTranslate">
    <div class="diff-metadata" *ngFor="let detail of diff.metadata">{{detail}}</div>
    <div class="diff-empty" *ngIf="diff.binary">{{ '二进制文件，无法显示文本差异。' | arwTranslate }}</div>
    <ng-container *ngIf="diff.combined"><div class="diff-empty">{{ '合并冲突的组合差异，请先解决冲突。' | arwTranslate }}</div><pre>{{diffPatch}}</pre></ng-container>
    <div class="diff-empty" *ngIf="!diff.binary && !diff.combined && !diff.hunks.length">{{ '没有文本差异（可能仅文件名、权限或空文件发生变化）。' | arwTranslate }}</div>
    <ng-container *ngIf="!diff.combined">
      <div class="split-labels" *ngIf="diffMode==='split' && diff.hunks.length"><span>{{diffLabel ? ('父提交 · 修改前' | arwTranslate) : (diffStaged ? ('HEAD · 提交前' | arwTranslate) : ('暂存区 · 修改前' | arwTranslate))}}</span><span>{{diffLabel ? ('当前提交 · 修改后' | arwTranslate) : (diffStaged ? ('暂存区 · 待提交' | arwTranslate) : ('工作区 · 修改后' | arwTranslate))}}</span></div>
      <section class="diff-hunk" *ngFor="let hunk of visibleHunks">
        <div class="hunk-header" *ngIf="hunk.file">{{hunk.file}}</div>
        <div class="hunk-header">{{hunk.header}}</div>
        <div *ngIf="diffMode==='split'" class="split-diff">
          <div class="diff-pane" #oldPane (scroll)="newPane.scrollLeft=oldPane.scrollLeft"><div class="diff-cell" *ngFor="let row of hunk.rows" [class.deleted]="row.old?.kind==='delete'" [class.empty-cell]="!row.old" [class.note]="row.old?.kind==='note'"><span class="line-number">{{row.old?.oldNumber}}</span><span class="line-sign">{{row.old?.kind==='delete' ? '−' : ''}}</span><code>{{row.old?.text}}</code></div></div>
          <div class="diff-pane" #newPane (scroll)="oldPane.scrollLeft=newPane.scrollLeft"><div class="diff-cell" *ngFor="let row of hunk.rows" [class.added]="row.next?.kind==='add'" [class.empty-cell]="!row.next" [class.note]="row.next?.kind==='note'"><span class="line-number">{{row.next?.newNumber}}</span><span class="line-sign">{{row.next?.kind==='add' ? '+' : ''}}</span><code>{{row.next?.text}}</code></div></div>
        </div>
        <div *ngIf="diffMode==='unified'" class="unified-diff"><div class="unified-row" *ngFor="let line of hunk.lines" [class.added]="line.kind==='add'" [class.deleted]="line.kind==='delete'" [class.note]="line.kind==='note'"><span class="line-number">{{line.oldNumber}}</span><span class="line-number">{{line.newNumber}}</span><span class="line-sign">{{line.kind==='add' ? '+' : line.kind==='delete' ? '−' : ''}}</span><code>{{line.text}}</code></div></div>
      </section>
    </ng-container>
  </div>
</ng-container>
<div *ngIf="markdownPreview && markdownError" class="error" role="alert">{{markdownError}}</div>
<article *ngIf="markdownPreview" class="markdown-preview" [innerHTML]="markdown" (click)="markdownClick($event)"></article>
<textarea #textEditor *ngIf="!isDiff && !markdownPreview" [readOnly]="readonly || loading || saving" [(ngModel)]="content" (ngModelChange)="search.visible && search.changed()" (keydown.control.s)="saveKey($event)" (keydown.meta.s)="saveKey($event)" spellcheck="false" wrap="off" [attr.aria-label]="'文件内容' | arwTranslate"></textarea>
`

export const EDITOR_STYLES = scaleTypography(`
${TEXT_SEARCH_STYLES}
${MARKDOWN_STYLES}
:host{font-family:var(--arw-font-family,inherit);font-size:12px;line-height:1.45}
:host ::ng-deep > .arw-ai-header{margin:-12px -12px 0}
@media(max-width:650px){:host ::ng-deep > .arw-ai-header{margin:-8px -8px 0}}
.diff-description{padding:8px 14px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:120px;overflow:auto;flex:none}
.split-diff{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.diff-pane{min-width:0;overflow-x:auto;scrollbar-width:thin}.diff-pane+.diff-pane{border-left:1px solid var(--diff-border)}.diff-pane>.diff-cell,.diff-pane>.diff-cell+.diff-cell{overflow:visible;min-width:max-content;border-left:0}
:host{--diff-border:color-mix(in srgb,currentColor 12%,transparent);--diff-muted:color-mix(in srgb,currentColor 50%,transparent);--diff-added:#75c79b;--diff-removed:#ed9d96;display:flex;height:100%;min-height:0;flex-direction:column;gap:8px;padding:12px;background:var(--theme-bg,#202124);color:var(--theme-fg,inherit)}
header{display:flex;align-items:center;justify-content:space-between;gap:10px}.file-heading{display:flex;flex-direction:column;min-width:0;gap:3px}.file-heading strong,.file-heading small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-heading small{font-size:11px;color:var(--diff-muted)}textarea{flex:1;min-height:0;width:100%;resize:none;background:transparent;color:inherit;border:1px solid var(--diff-border);font-family:monospace;tab-size:4;white-space:pre}.error{color:var(--diff-removed);overflow-wrap:anywhere}.connection-status{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--diff-border);border-radius:5px;color:var(--diff-muted);flex:none}.diff-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:11px;flex:none}.diff-toolbar button{border:1px solid var(--diff-border);border-radius:4px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.diff-toolbar button:hover,.diff-toolbar button.selected{background:color-mix(in srgb,currentColor 10%,transparent)}.diff-toolbar button:focus-visible{outline:2px solid #73a9ed}.diff-toolbar button:disabled{opacity:.4;cursor:default}.view-switch{display:flex;gap:2px}.comparison-label,.hunk-position{color:var(--diff-muted)}.toolbar-spacer{flex:1}.diff-added{color:var(--diff-added)}.diff-removed{color:var(--diff-removed)}.diff-scroll{flex:1;min-height:0;overflow:auto;border:1px solid var(--diff-border);border-radius:5px;font:12px/1.65 monospace;tab-size:4}.split-labels{position:sticky;top:0;z-index:1;display:grid;grid-template-columns:1fr 1fr;background:var(--theme-bg,#202124);font:11px/1.5 inherit;border-bottom:1px solid var(--diff-border)}.split-labels>span{padding:7px 12px}.split-labels>span+span{border-left:1px solid var(--diff-border)}.hunk-header{padding:5px 12px;background:#73a9ed12;color:#8eb6db;white-space:pre;min-width:max-content}.split-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.diff-cell{display:flex;min-width:0;overflow-x:auto;scrollbar-width:thin}.diff-cell+.diff-cell{border-left:1px solid var(--diff-border)}.unified-row{display:flex;min-width:max-content}.line-number{flex:none;width:4.5em;padding:0 8px;text-align:right;color:var(--diff-muted);user-select:none;font-size:11px;background:#00000008}.line-sign{flex:none;width:1.7em;text-align:center;user-select:none}.diff-cell code,.unified-row code{font:inherit;color:inherit;white-space:pre;padding-right:14px;min-height:1.65em}.added{background:#69be8f18}.added .line-sign{color:var(--diff-added)}.deleted{background:#e8776418}.deleted .line-sign{color:var(--diff-removed)}.empty-cell{background:repeating-linear-gradient(135deg,transparent,transparent 4px,#88888806 4px,#88888806 6px)}.note{color:var(--diff-muted);font-style:italic}.diff-empty,.diff-metadata{padding:12px;color:var(--diff-muted)}.diff-metadata{padding-bottom:0;font-size:11px}.diff-scroll pre{padding:12px;white-space:pre;overflow:auto;color:inherit}@media(max-width:650px){:host{padding:8px}.diff-toolbar{gap:5px}.line-number{width:3em;padding:0 4px}.comparison-label{flex-basis:100%}}

:host,*{box-sizing:border-box}header{flex:none}.file-heading{flex:1}header>button{flex:none}textarea{padding:10px 12px;border-radius:5px;line-height:1.65;outline:none}textarea:focus{border-color:#73a9ed;box-shadow:0 0 0 2px #73a9ed18}.comparison-label{min-width:0;overflow-wrap:anywhere}.split-labels>span{min-width:0;overflow-wrap:anywhere}
${FILE_TOOLBAR_STYLES}
`)
