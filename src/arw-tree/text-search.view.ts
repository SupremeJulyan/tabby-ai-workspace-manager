export const TEXT_SEARCH_TEMPLATE=`
<section *ngIf="search.visible" class="text-search" [attr.aria-label]="'查找和替换' | arwTranslate" (keydown.enter)="$event.preventDefault(); search.navigate($event.shiftKey ? -1 : 1)">
 <div class="find-row">
  <button *ngIf="search.canReplace()" (click)="search.replaceVisible=!search.replaceVisible" [attr.aria-expanded]="search.replaceVisible" [title]="'替换' | arwTranslate">{{search.replaceVisible ? '▾' : '▸'}}</button>
  <input #findInput [(ngModel)]="search.query" (ngModelChange)="search.changed()" [placeholder]="'查找' | arwTranslate" [attr.aria-label]="'查找' | arwTranslate" spellcheck="false"/>
  <button (click)="search.matchCase=!search.matchCase;search.changed()" [class.selected]="search.matchCase" [attr.aria-pressed]="search.matchCase" [title]="'区分大小写' | arwTranslate">Aa</button>
  <button (click)="search.wholeWord=!search.wholeWord;search.changed()" [class.selected]="search.wholeWord" [attr.aria-pressed]="search.wholeWord" [title]="'全字匹配' | arwTranslate">ab</button>
  <button (click)="search.regex=!search.regex;search.changed()" [class.selected]="search.regex" [attr.aria-pressed]="search.regex" [title]="'正则表达式' | arwTranslate">.*</button>
  <span class="find-count" role="status">{{search.count}}</span>
  <button (click)="search.navigate(-1)" [disabled]="!search.matches.length" [title]="'上一个匹配' | arwTranslate">↑</button>
  <button (click)="search.navigate(1)" [disabled]="!search.matches.length" [title]="'下一个匹配' | arwTranslate">↓</button>
  <button (click)="search.close()" [title]="'关闭搜索' | arwTranslate">×</button>
 </div>
 <div *ngIf="search.replaceVisible && search.canReplace()" class="find-row">
  <input [(ngModel)]="search.replacement" [placeholder]="'替换为' | arwTranslate" [attr.aria-label]="'替换为' | arwTranslate" spellcheck="false"/>
  <button (click)="search.replaceOne()" [disabled]="!search.matches.length || !!search.error">{{'替换' | arwTranslate}}</button>
  <button (click)="search.replaceAll()" [disabled]="!search.matches.length || !!search.error || search.limited">{{'全部替换' | arwTranslate}}</button>
 </div>
 <div *ngIf="search.error" class="find-error" role="alert">{{search.error}}</div>
 <div *ngIf="search.limited" class="find-error" role="status">{{'匹配超过 10000 项，请缩小搜索范围后替换' | arwTranslate}}</div>
</section>`

export const TEXT_SEARCH_STYLES=`
.text-search{flex:none;padding:8px;border:1px solid #8885;border-radius:5px;background:#88888808;font-size:12px}.find-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.find-row+.find-row{margin-top:6px}.find-row input{flex:1 1 160px;min-width:80px;min-height:28px;border:1px solid #8885;border-radius:3px;background:var(--theme-bg,#202124);color:inherit;padding:4px 7px;font:inherit}.find-row button{flex:none;min-width:26px;min-height:28px;border:1px solid transparent;border-radius:3px;background:transparent;color:inherit;cursor:pointer;padding:3px 6px;font:inherit}.find-row button:hover,.find-row button.selected{background:#73a9ed22;border-color:#73a9ed66}.find-row button:disabled{opacity:.4;cursor:default}.find-row button:focus-visible,.find-row input:focus-visible{outline:2px solid #73a9ed;outline-offset:1px}.find-count{min-width:55px;text-align:center;font-size:11px;white-space:nowrap}.find-error{margin-top:5px;color:#ed9d96;font-size:11px}
`
