import { FILE_TOOLBAR_STYLES } from './file-toolbar.view'
import { MARKDOWN_STYLES } from './preview/markdown.view'
import { scaleTypography } from './fonts'
import { TEXT_SEARCH_TEMPLATE, TEXT_SEARCH_STYLES } from './text-search.view'

export const EDITOR_TEMPLATE = `
<header><div class="file-heading"><strong>{{filePath}}</strong><small>{{workspace?.label}}</small></div>
  <button *ngIf="!isDiff && !binaryBytes" class="file-icon-button" [title]="'查找' | arwTranslate" [attr.aria-label]="'查找' | arwTranslate" (click)="search.open()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"/></svg></button>
  <button *ngIf="!isDiff && !readonly" class="file-icon-button" [title]="'替换' | arwTranslate" [attr.aria-label]="'替换' | arwTranslate" (click)="search.open(true)" [disabled]="!search.canReplace()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg></button>
  <button *ngIf="!isDiff" class="file-icon-button" [title]="(saving ? '保存中…' : '保存') | arwTranslate" [attr.aria-label]="(saving ? '保存中…' : '保存') | arwTranslate" [disabled]="readonly || loading || saving || reconnecting || !dirty || saveIssue" (click)="save()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/></svg></button>
</header>
${TEXT_SEARCH_TEMPLATE}
<div *ngIf="largeTextReadOnly" class="preview-note" role="status">{{ '文件超过写入上限，只读打开。' | arwTranslate }} · {{editLimitMiB}} MiB</div>
<div *ngIf="pagedText && !binaryBytes" class="diff-toolbar">
  <ng-container *ngIf="markdownPreview">
    <button (click)="changeTextPage(-1)" [disabled]="textPage===0 || loading || saving || reconnecting || !!saveIssue">{{ '上一页' | arwTranslate }}</button>
    <button (click)="changeTextPage(1)" [disabled]="!hasMoreText || loading || saving || reconnecting || !!saveIssue">{{ '下一页' | arwTranslate }}</button>
  </ng-container>
  <button *ngIf="search.visible && search.query && !search.matches.length && !search.error" (click)="searchFullText()" [disabled]="loading || saving || reconnecting || !!saveIssue">{{ '未找到匹配，逐段搜索全文' | arwTranslate }}</button>
</div>
<div class="error" *ngIf="saveIssue as issue" role="alert">
  {{issue.message}}
  <button class="btn btn-sm btn-secondary" [disabled]="saving || loading || issue.busy" (click)="verifySave()">{{'核对远端文件' | arwTranslate}}</button>
  <button class="btn btn-sm btn-secondary" [disabled]="saving || loading || issue.busy" (click)="reloadSave()">{{'重新加载' | arwTranslate}}</button>
  <button class="btn btn-sm btn-warning" [disabled]="readonly || saving || loading || issue.busy" (click)="retrySave()">{{'再次保存' | arwTranslate}}</button>
</div>
<div class="error" *ngIf="error" role="alert">{{error}} <button *ngIf="canReconnect" class="btn btn-sm btn-secondary" (click)="reconnectFile()" [disabled]="reconnecting || loading || saving">{{(reconnecting ? '正在重新连接…' : '重新连接并打开') | arwTranslate}}</button><span *ngIf="canReconnect && dirty"> {{ '未保存的修改将保留，重连后请再次保存。' | arwTranslate }}</span></div>
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
<div *ngIf="markdownPreview && pagedText" class="preview-note" role="status">{{ '仅渲染当前文本页' | arwTranslate }}</div>
<article *ngIf="markdownPreview && isMarkdown" class="markdown-preview" tabindex="0" [innerHTML]="markdown" (click)="markdownClick($event)" (dblclick)="toggleContentMode($event)"></article>
<ng-container *ngIf="isCsv && markdownPreview && !loading">
 <div class="preview-toolbar"><label>{{ '分隔符' | arwTranslate }} <select [(ngModel)]="csvDelimiter" (ngModelChange)="parseTable()"><option value="auto">{{ '自动' | arwTranslate }}</option><option value=",">{{ '逗号' | arwTranslate }}</option><option value=";">{{ '分号' | arwTranslate }}</option><option [value]="'	'">Tab</option><option value="|">{{ '竖线' | arwTranslate }}</option></select></label><label><input type="checkbox" [(ngModel)]="csvHeader" (ngModelChange)="filterTable()"/> {{ '首行表头' | arwTranslate }}</label><input class="csv-filter" [(ngModel)]="csvQuery" (ngModelChange)="filterTable()" [placeholder]="'筛选表格内容' | arwTranslate" [attr.aria-label]="'筛选 CSV' | arwTranslate"/><span>{{csvFiltered.length}} {{ '行 ·' | arwTranslate }} {{csv.columns}} {{ '列' | arwTranslate }}</span></div>
 <div class="preview-note" *ngIf="csv.truncated">{{ '已限制预览：最多 10,000 行数据、200 列；请查看源码或下载完整文件。' | arwTranslate }}</div>
 <div class="csv-scroll" *ngIf="!markdownError" (dblclick)="toggleContentMode($event)"><table><thead><tr><th class="row-number">{{ '行' | arwTranslate }}</th><th *ngFor="let header of csvHeaders">{{header}}</th></tr></thead><tbody><tr *ngFor="let row of csvPageRows"><th class="row-number">{{row.index}}</th><td *ngFor="let header of csvHeaders; let column=index">{{row.values[column] || ''}}</td></tr></tbody></table><div *ngIf="!csvFiltered.length" class="preview-note">{{ '没有可显示的数据' | arwTranslate }}</div></div>
 <div class="preview-toolbar"><button (click)="changeCsvPage(-1)" [disabled]="csvPage<=1" class="file-icon-button" [title]="'上一页' | arwTranslate" [attr.aria-label]="'上一页' | arwTranslate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button><span>{{csvPage}} / {{csvPages}} {{ '· 每页 100 行' | arwTranslate }}</span><button (click)="changeCsvPage(1)" [disabled]="csvPage>=csvPages" class="file-icon-button" [title]="'下一页' | arwTranslate" [attr.aria-label]="'下一页' | arwTranslate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button></div>
</ng-container>
<ng-container *ngIf="binaryBytes && !loading && !error">
 <div class="diff-toolbar"><span>{{ '二进制文件（只读）' | arwTranslate }} · {{binaryFileSize | number}} {{ '字节' | arwTranslate }} · {{binaryPage+1}} / {{binaryPages}}</span></div>
 <pre class="binary-content" tabindex="0" (scroll)="scrollBinaryWindow($event)" [attr.aria-label]="'十六进制内容' | arwTranslate">{{binaryContent}}</pre>
</ng-container>
<div *ngIf="!isDiff && !markdownPreview && !binaryBytes" class="editor-surface" [class.soft-wrap]="softWrap" [class.has-multi-cursors]="multiCursorCount>1">
 <pre #lineGutter class="line-gutter" aria-hidden="true">{{editorLineNumbers}}</pre>
 <pre #editorOverlay *ngIf="multiCursorCount>1" class="editor-overlay" aria-hidden="true" [innerHTML]="multiCursorMarkup"></pre>
 <textarea #textEditor [readOnly]="readonly || viewOnly || loading || saving || reconnecting" [(ngModel)]="editorText" (ngModelChange)="search.visible && search.changed()" (scroll)="syncEditorScroll($event)" (wheel)="syncEditorScroll($event)" (keydown)="editorKeydown($event)" (beforeinput)="handleMultiInput($event)" (copy)="copyMulti($event)" (cut)="cutMulti($event)" (paste)="pasteMulti($event)" (keyup)="updateCaretPosition()" (click)="updateCaretPosition()" (input)="editorInput()" (pointerdown)="columnPointerDown($event)" (pointermove)="columnPointerMove($event)" (pointerup)="columnPointerUp()" (pointercancel)="columnPointerUp()" (keydown.control.s)="saveKey($event)" (keydown.meta.s)="saveKey($event)" (dblclick)="toggleContentMode($event)" spellcheck="false" [attr.wrap]="softWrap ? 'soft' : 'off'" [attr.aria-label]="'文件内容' | arwTranslate"></textarea>
</div>
<footer *ngIf="!isDiff && !markdownPreview && !binaryBytes" class="editor-status">
 <span>{{'第几行' | arwTranslate}} {{caretLine}}, {{'第几列' | arwTranslate}} {{caretColumn}}</span><span *ngIf="multiCursorCount>1">{{multiCursorCount}} {{ '个光标' | arwTranslate }}</span>
 <span class="status-spacer"></span>
 <button type="button" (click)="softWrap=!softWrap">{{softWrap ? ('软换行' | arwTranslate) : ('不换行' | arwTranslate)}}</button>
 <label>{{'编码' | arwTranslate}} <select [(ngModel)]="textEncoding" [disabled]="readonly"><option>UTF-8</option><option>UTF-8 BOM</option></select></label>
 <label>{{'换行符' | arwTranslate}} <select [(ngModel)]="lineEnding" [disabled]="readonly"><option>LF</option><option>CRLF</option></select></label>
 <ng-container *ngIf="lineJumpVisible"><input #lineJumpInputElement type="number" min="1" [max]="pagedText ? undefined : (content.split('\n').length)" [(ngModel)]="lineJumpInput" (keydown.enter)="jumpToLine()" (keydown.escape)="lineJumpVisible=false" [attr.aria-label]="'跳转到行' | arwTranslate"/><button type="button" (click)="jumpToLine()">{{'跳转' | arwTranslate}}</button></ng-container>
 <button type="button" *ngIf="!lineJumpVisible" (click)="openLineJump()">{{'跳转到行' | arwTranslate}}</button>
</footer>
`

export const EDITOR_STYLES = scaleTypography(`
${TEXT_SEARCH_STYLES}
.preview-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.preview-note{opacity:.75;padding:6px 0}.csv-scroll{flex:1;min-height:0;overflow:auto}.csv-scroll table{border-collapse:collapse}.csv-scroll th,.csv-scroll td{border:1px solid var(--diff-border);padding:4px 8px;white-space:pre-wrap}.csv-scroll thead{position:sticky;top:0;background:var(--theme-bg,#202124)}
.editor-surface{position:relative;display:flex;flex:1;min-height:0;min-width:0;border:1px solid var(--diff-border);border-radius:5px;overflow:hidden}.editor-surface textarea{border:0;border-radius:0}.line-gutter{flex:none;width:4.5em;overflow:hidden;user-select:none;text-align:right;margin:0;padding:10px 8px 10px 10px;color:var(--diff-muted);border-right:1px solid var(--diff-border);font:inherit;line-height:1.65;white-space:pre;background:#00000008}.editor-overlay{position:absolute;z-index:1;left:4.5em;right:0;top:0;bottom:0;overflow:hidden;pointer-events:none;margin:0;padding:10px 12px;color:inherit;font:12px/1.65 monospace;tab-size:4;white-space:pre}.multi-selection{background:#73a9ed55;outline:1px solid #73a9ed66}.multi-cursor{display:inline-block;width:0;height:1em;vertical-align:text-bottom;border-left:1px solid #73a9ed}.editor-surface.has-multi-cursors textarea{color:transparent;caret-color:var(--theme-fg, currentColor)}.editor-surface.has-multi-cursors textarea::selection{background:transparent}.editor-status{display:flex;align-items:center;gap:10px;flex:none;min-width:0;font-size:10px;color:var(--diff-muted)}.editor-status label{display:flex;align-items:center;gap:4px}.editor-status select,.editor-status input,.editor-status button{font:inherit;color:inherit;background:transparent;border:1px solid var(--diff-border);border-radius:3px;padding:2px 5px}.editor-status input{width:5em}.editor-status button{cursor:pointer}.status-spacer{flex:1}.editor-surface.soft-wrap textarea,.editor-surface.soft-wrap .editor-overlay{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden}
.binary-content{flex:1;min-height:0;overflow:auto;white-space:pre;font:12px/1.65 monospace;color:inherit;padding:12px;border:1px solid var(--diff-border);border-radius:5px;margin:0}
${MARKDOWN_STYLES}
:host{font-family:var(--arw-font-family,inherit);font-size:12px;line-height:1.45}
:host ::ng-deep > .arw-ai-header{margin:-12px -12px 0}
@media(max-width:650px){:host ::ng-deep > .arw-ai-header{margin:-8px -8px 0}}
.diff-description{padding:8px 14px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:120px;overflow:auto;flex:none}
.split-diff{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.diff-pane{min-width:0;overflow-x:auto;scrollbar-width:thin}.diff-pane+.diff-pane{border-left:1px solid var(--diff-border)}.diff-pane>.diff-cell,.diff-pane>.diff-cell+.diff-cell{overflow:visible;min-width:max-content;border-left:0}
:host{--diff-border:color-mix(in srgb,currentColor 12%,transparent);--diff-muted:color-mix(in srgb,currentColor 50%,transparent);--diff-added:#75c79b;--diff-removed:#ed9d96;display:flex;height:100%;min-height:0;flex-direction:column;gap:8px;padding:12px;background:color-mix(in srgb,var(--theme-bg,#202124) 70%,transparent);color:var(--theme-fg,inherit)}
header{display:flex;align-items:center;justify-content:space-between;gap:10px}.file-heading{display:flex;flex-direction:column;min-width:0;gap:3px}.file-heading strong,.file-heading small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-heading small{font-size:11px;color:var(--diff-muted)}textarea{flex:1;min-height:0;width:100%;resize:none;background:transparent;color:inherit;border:1px solid var(--diff-border);font-family:monospace;tab-size:4;white-space:pre}.error{color:var(--diff-removed);overflow-wrap:anywhere}.connection-status{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--diff-border);border-radius:5px;color:var(--diff-muted);flex:none}.diff-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:11px;flex:none}.diff-toolbar button{border:1px solid var(--diff-border);border-radius:4px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.diff-toolbar button:hover,.diff-toolbar button.selected{background:color-mix(in srgb,currentColor 10%,transparent)}.diff-toolbar button:focus-visible{outline:2px solid #73a9ed}.diff-toolbar button:disabled{opacity:.4;cursor:default}.view-switch{display:flex;gap:2px}.comparison-label,.hunk-position{color:var(--diff-muted)}.toolbar-spacer{flex:1}.diff-added{color:var(--diff-added)}.diff-removed{color:var(--diff-removed)}.diff-scroll{flex:1;min-height:0;overflow:auto;border:1px solid var(--diff-border);border-radius:5px;font:12px/1.65 monospace;tab-size:4}.split-labels{position:sticky;top:0;z-index:1;display:grid;grid-template-columns:1fr 1fr;background:var(--theme-bg,#202124);font:11px/1.5 inherit;border-bottom:1px solid var(--diff-border)}.split-labels>span{padding:7px 12px}.split-labels>span+span{border-left:1px solid var(--diff-border)}.hunk-header{padding:5px 12px;background:#73a9ed12;color:#8eb6db;white-space:pre;min-width:max-content}.split-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.diff-cell{display:flex;min-width:0;overflow-x:auto;scrollbar-width:thin}.diff-cell+.diff-cell{border-left:1px solid var(--diff-border)}.unified-row{display:flex;min-width:max-content}.line-number{flex:none;width:4.5em;padding:0 8px;text-align:right;color:var(--diff-muted);user-select:none;font-size:11px;background:#00000008}.line-sign{flex:none;width:1.7em;text-align:center;user-select:none}.diff-cell code,.unified-row code{font:inherit;color:inherit;white-space:pre;padding-right:14px;min-height:1.65em}.added{background:#69be8f18}.added .line-sign{color:var(--diff-added)}.deleted{background:#e8776418}.deleted .line-sign{color:var(--diff-removed)}.empty-cell{background:repeating-linear-gradient(135deg,transparent,transparent 4px,#88888806 4px,#88888806 6px)}.note{color:var(--diff-muted);font-style:italic}.diff-empty,.diff-metadata{padding:12px;color:var(--diff-muted)}.diff-metadata{padding-bottom:0;font-size:11px}.diff-scroll pre{padding:12px;white-space:pre;overflow:auto;color:inherit}@media(max-width:650px){:host{padding:8px}.diff-toolbar{gap:5px}.line-number{width:3em;padding:0 4px}.comparison-label{flex-basis:100%}}

:host,*{box-sizing:border-box}header{flex:none}.file-heading{flex:1}header>button{flex:none}textarea{padding:10px 12px;border-radius:5px;line-height:1.65;outline:none}textarea:focus{border-color:#73a9ed;box-shadow:0 0 0 2px #73a9ed18}.comparison-label{min-width:0;overflow-wrap:anywhere}.split-labels>span{min-width:0;overflow-wrap:anywhere}
${FILE_TOOLBAR_STYLES}
`)
