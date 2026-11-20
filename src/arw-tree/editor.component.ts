import { optionalSftp } from '../adapters/optional-sftp'
import { checkFileReadSize, checkFileWriteSize, fileReadLimit, fileWriteLimit } from '../shared/file-size-policy'
import { posix } from 'node:path'
import { shellQuote } from '../shared/shell-quote'
import { FileSessionPool } from '../services/file-session-pool'
import { remoteWorkspace } from '../adapters/remote-workspace'
import { isBinaryFileError, binaryPageBytes, formatHexPage } from '../shared/binary-file'
import { filePaneReleaseDelayMs, type PaneLayout } from '../shared/pane-layout'
import { t } from '../shared/i18n'
import { AfterViewInit, Component, Injector, ElementRef, HostListener, ViewChild } from '@angular/core'
import { AppService, BaseTabComponent, NotificationsService, PlatformService, type GetRecoveryTokenOptions, type RecoveryToken } from 'tabby-core'
import { Workspace } from './workspace'
import { parseDiff, DiffModel, DiffHunk } from './git/diff-model'
import { EDITOR_TEMPLATE, EDITOR_STYLES } from './editor.view'
import { registerOpenedWorkspaceFile } from '../services/opened-files.service'
import { fileWorkspaceToken, resolveFileWorkspace } from './file-recovery'
import { TextSearch, type FindState } from './text-search'
import { logFileRecovery } from '../services/file-recovery-log'
import { addFileCloseButton } from '../arw-ai-cli/close-button'
import { isFileConflict, isFileMissing } from '../shared/file-conflict'
import { previewKind, renderMarkdown, markdownImages, relativePreviewAsset, imageMime, parseCsv, detectDelimiter, type CsvPreview } from './preview/model'

const editorChunkBytes=256*1024
interface EditorPage {offset:number;start:number;line?:number}
interface PageText {text:string;length:number;more:boolean}
interface PageEdit {start:number;original:string;content:string}
class ReadRestarted extends Error {}

@Component({
    selector: 'arw-editor',
    template: EDITOR_TEMPLATE,
    styles: [EDITOR_STYLES],
})
export class ArwEditorComponent extends BaseTabComponent implements AfterViewInit {
    readonly arwFilePane=true
    get arwWorkspaceIdentity(){return this.workspace&&fileWorkspaceToken(this.workspace)}
    arwPaneLayout:PaneLayout='stacked'
    workspace!: Workspace
    filePath = ''
    content = ''
    original = ''
    hash?: string
    readonly = false
    largeTextReadOnly=false
    get editLimitMiB():number{return fileWriteLimit(this.workspace?.kind??'local')/(1024*1024)}
    viewOnly=false
    renderOnOpen=false
    initialContent?: string
    diffPatch?: string
    diffLabel?: string
    diffDescription?: string
    diffStaged = false
    diff?: DiffModel
    diffMode: 'split'|'unified' = 'split'
    activeHunk = -1
    loading = true
    saving = false
    error = ''
    binaryBytes?:Uint8Array
    binaryPage=0
    private pages:EditorPage[]=[]
    private pageCache=new Map<number,PageText>()
    private pageEdits=new Map<number,PageEdit>()
    private textScrollAdjusting=false
    private textWindowCache?:{parts:string[];text:string}
    private hexWindowCache?:{bytes:Uint8Array;page:number;text:string}
    textPage=0
    softWrap=false
    lineEnding:'LF'|'CRLF'='LF'
    textEncoding:'UTF-8'|'UTF-8 BOM'='UTF-8'
    private savedLineEnding:'LF'|'CRLF'='LF'
    private savedTextEncoding:'UTF-8'|'UTF-8 BOM'='UTF-8'
    caretLine=1
    caretColumn=1
    lineJumpVisible=false
    lineJumpInput='1'
    multiCursorCount=0
    @ViewChild('lineGutter') lineGutter?:ElementRef<HTMLElement>
    @ViewChild('editorOverlay') editorOverlay?:ElementRef<HTMLElement>
    @ViewChild('lineJumpInputElement') lineJumpInputElement?:ElementRef<HTMLInputElement>
    private multiSelections:Array<{start:number;end:number}>=[]
    private multiUndo:Array<{text:string;start:number;end:number}>=[]
    private multiRedo:Array<{text:string;start:number;end:number}>=[]
    private columnDragAnchor?:{line:number;column:number}
    get pagedText():boolean{return this.pages.length>0}
    private needsFileVersion=false
    hasMoreText=false
    get binaryPages():number {return Math.max(1,Math.ceil((this.binaryBytes?.length??0)/binaryPageBytes))}
    get binaryContent():string {
        if(!this.binaryBytes){this.hexWindowCache=undefined;return ''}
        if(this.hexWindowCache?.bytes===this.binaryBytes&&this.hexWindowCache.page===this.binaryPage)return this.hexWindowCache.text
        const pages:string[]=[]
        for(let index=Math.max(0,this.binaryPage-1);index<=Math.min(this.binaryPages-1,this.binaryPage+1);index++){
            pages.push(formatHexPage(this.binaryBytes,index))
        }
        const text=pages.join('\n')
        this.hexWindowCache={bytes:this.binaryBytes,page:this.binaryPage,text}
        return text
    }
    scrollBinaryWindow(event:Event):void {
        if(this.textScrollAdjusting||!this.binaryBytes)return
        const view=event.currentTarget as HTMLElement
        const down=view.scrollHeight-view.scrollTop-view.clientHeight<view.clientHeight
        const oldFirst=Math.max(0,this.binaryPage-1)
        const next=this.binaryPage+(down?1:view.scrollTop<view.clientHeight?-1:0)
        if(next===this.binaryPage||next<0||next>=this.binaryPages||
            (down&&this.binaryPage+1>=this.binaryPages-1)||(!down&&oldFirst===0))return
        const lineHeight=parseFloat(getComputedStyle(view).lineHeight)||16
        const scrollTop=view.scrollTop-(Math.max(0,next-1)-oldFirst)*(binaryPageBytes/16)*lineHeight
        this.textScrollAdjusting=true
        this.binaryPage=next
        requestAnimationFrame(()=>{view.scrollTop=Math.max(0,scrollTop);this.textScrollAdjusting=false})
    }
    private async readFile():Promise<void>{
        let attempt=0
        while(true){
            try{await this.readFileOnce();return}
            catch(error){
                if(!this.isRemoteReadRace(error)||this.dirty||this.recoveryController.signal.aborted)throw error
                logFileRecovery('editor-read-retry',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),attempt:++attempt,error:String(error)})
                this.resetPages();this.binaryBytes=undefined;this.content='';this.original=''
                await new Promise(resolve=>setTimeout(resolve,Math.min(50*attempt,500)))
            }
        }
    }
    private isRemoteReadRace(error:unknown):boolean{
        if(this.workspace?.kind!=='remote')return false
        const message=String(error)
        return message.includes('在读取时发生变化')||message.includes('已在外部修改，无法合并尚未加载的内容')
    }
    private async refreshAfterReadRace():Promise<never>{
        logFileRecovery('editor-read-restart',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),reason:'remote-file-changed'})
        this.resetPages();this.binaryBytes=undefined;this.content='';this.original='';this.error=''
        await this.readFile()
        this.original=this.content
        if(this.search.visible)this.search.changed()
        throw new ReadRestarted()
    }
    private async readFileOnce():Promise<void> {
        const signal=this.recoveryController.signal
        const readStarted=performance.now(),logStep=(stage:string,started:number,details:Record<string,unknown>={})=>logFileRecovery('editor-file-read-step',{
            stage,filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),durationMs:Math.round((performance.now()-started)*100)/100,...details,
        })
        let size=0,outcome='ready'
        try {
            let stepStarted=performance.now()
            size=await this.workspace.fileSize?.(this.filePath,signal)??0
            logStep('file-size-complete',stepStarted,{size})
            checkFileReadSize(this.workspace.kind,size)
            this.largeTextReadOnly=size>fileWriteLimit(this.workspace.kind)
            this.readonly=this.largeTextReadOnly
            stepStarted=performance.now()
            const file=await this.workspace.read(this.filePath,this.recoveryController.signal)
            logStep('full-file-read-complete',stepStarted,{characters:file.content.length})
            stepStarted=performance.now()
            this.setTextFormat(new TextEncoder().encode(file.content))
            this.content=file.content.replace(/\r\n?/g,'\n');this.hash=file.hash
            logStep('full-content-ready',stepStarted,{characters:this.content.length})
        }catch(error){
            outcome='error'
            if(!isBinaryFileError(error)||!this.workspace.readBytes)throw error
            const stepStarted=performance.now()
            this.binaryBytes=await this.workspace.readBytes(this.filePath,fileReadLimit(this.workspace.kind),this.recoveryController.signal)
            this.binaryPage=0;this.readonly=true;this.content='';this.hash=undefined
            outcome='binary'
            logStep('binary-content-ready',stepStarted,{bytes:this.binaryBytes.length})
        }finally{
            logFileRecovery('editor-file-read-complete',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),durationMs:Math.round((performance.now()-readStarted)*100)/100,size,outcome,mode:'full'})
        }
        this.resetPages();this.needsFileVersion=false
        this.savedLineEnding=this.lineEnding;this.savedTextEncoding=this.textEncoding
    }
    private setTextFormat(bytes:Uint8Array):void{
        this.textEncoding=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'UTF-8 BOM':'UTF-8'
        const sample=new TextDecoder().decode(bytes)
        const crlf=(sample.match(/\r\n/g)??[]).length,lf=(sample.match(/(?<!\r)\n/g)??[]).length
        this.lineEnding=crlf>lf?'CRLF':'LF'
    }
    private decodeEditorChunk(bytes:Uint8Array,offset:number):{text:string;length:number}{
        let length=Math.min(bytes.length,editorChunkBytes)
        while(length>0&&length<bytes.length&&(bytes[length]&0xc0)===0x80)length--
        if(!length&&bytes.length)throw new TypeError('Invalid UTF-8 boundary')
        const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:offset>0}).decode(bytes.subarray(0,length))
        return {text,length}
    }
    private resetPages():void {
        this.pages=[];this.pageCache.clear();this.pageEdits.clear()
        this.textWindowCache=undefined
        this.textPage=0;this.hasMoreText=false
    }
    private rememberPageEdit():void {
        if(!this.pagedText)return
        const {start}=this.pages[this.textPage]
        if(this.content===this.original)this.pageEdits.delete(start)
        else this.pageEdits.set(start,{start,original:this.original,content:this.content})
    }
    private async fetchPage(index:number):Promise<PageText>{
      try{
        const cached=this.pageCache.get(index)
        if(cached)return cached
        const {offset,start}=this.pages[index]
        const bytes=await this.workspace.readByteRange!(this.filePath,offset,editorChunkBytes+1,this.recoveryController.signal,true)
        if(bytes.includes(0))throw new Error(t('暂不支持二进制文件'))
        const chunk=this.decodeEditorChunk(bytes,offset),more=chunk.length<bytes.length
        const next=this.pages[index+1]
        if(next&&(!more||next.offset!==offset+chunk.length||next.start!==start+chunk.text.length)){
            throw new Error(t('文件内容已在外部修改，无法合并尚未加载的内容。'))
        }
        const line=(this.pages[index].line??1)+(chunk.text.match(/\n/g)?.length??0)
        if(more&&!next)this.pages[index+1]={offset:offset+chunk.length,start:start+chunk.text.length,line}
        else if(next&&next.line===undefined)next.line=line
        else if(next&&next.line!==line)throw new Error(t('文件内容已在外部修改，无法合并尚未加载的内容。'))
        return {...chunk,more}
      }catch(error){
        if(this.isRemoteReadRace(error)&&!this.dirty&&!this.recoveryController.signal.aborted)return this.refreshAfterReadRace()
        throw error
      }
    }
    private showPage(index:number,page:PageText):void {
        const {offset,start}=this.pages[index]
        if(page.more&&!this.pages[index+1])this.pages[index+1]={offset:offset+page.length,start:start+page.text.length,line:(this.pages[index].line??1)+(page.text.match(/\n/g)?.length??0)}
        this.textPage=index;this.hasMoreText=page.more
        this.multiSelections=[];this.multiCursorCount=0
        this.pageCache.set(index,page)
        for(const cached of this.pageCache.keys())if(Math.abs(cached-index)>1)this.pageCache.delete(cached)
        const edit=this.pageEdits.get(start)
        this.original=edit?.original??page.text;this.content=edit?.content??page.text
        this.clearRenderedPreview()
    }
    private visibleTextSegments():Array<{index:number;text:string}>{
        return [...this.pageCache.keys()].filter(index=>Math.abs(index-this.textPage)<=1)
            .sort((a,b)=>a-b).map(index=>({
                index,text:index===this.textPage?this.content:
                    this.pageEdits.get(this.pages[index].start)?.content??this.pageCache.get(index)!.text,
            }))
    }
    private lineStart(index:number):number{
        let line=this.pages[index]?.line??1
        for(const edit of this.pageEdits.values()){
            const pageIndex=this.pages.findIndex(page=>page.start===edit.start)
            if(pageIndex>=0&&pageIndex<index)line+=(edit.content.match(/\n/g)?.length??0)-(edit.original.match(/\n/g)?.length??0)
        }
        return line
    }
    get editorLineNumbers():string{
        const source=this.editorText.split('\n'),first=this.visibleTextSegments()[0]?.index??this.textPage
        const start=this.pagedText?this.lineStart(first):1
        const editor=this.textEditor?.nativeElement
        let columns=Number.POSITIVE_INFINITY
        if(this.softWrap&&editor){
            const style=getComputedStyle(editor),fontSize=parseFloat(style.fontSize)||12,charWidth=fontSize*.6
            columns=Math.max(1,Math.floor((editor.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-12)/charWidth))
        }
        const visual:string[]=[]
        source.forEach((line,index)=>{
            let width=0
            for(const character of line)width+=character==='\t'?4-width%4:/[^\x00-\xff]/.test(character)?2:1
            const rows=Math.max(1,Math.ceil(width/columns))
            visual.push(String(start+index),...Array.from({length:rows-1},()=>''))
        })
        return visual.join('\n')
    }
    get multiCursorMarkup():string{
        const text=this.editorText,ranges=[...this.multiSelections].sort((a,b)=>a.start-b.start),escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        let offset=0,markup=''
        for(const range of ranges){
            if(range.start<offset)continue
            markup+=escape(text.slice(offset,range.start))
            if(range.start===range.end)markup+='<span class="multi-cursor">&#8203;</span>'
            else markup+=`<span class="multi-selection">${escape(text.slice(range.start,range.end))}</span>`
            offset=range.end
        }
        return markup+escape(text.slice(offset))
    }
    updateCaretPosition():void{
        const editor=this.textEditor?.nativeElement
        if(!editor)return
        const before=this.editorText.slice(0,editor.selectionStart),first=this.visibleTextSegments()[0]?.index??this.textPage
        const start=this.pagedText?this.lineStart(first):1
        this.caretLine=start+(before.match(/\n/g)?.length??0)
        this.caretColumn=before.length-(before.lastIndexOf('\n')+1)+1
        this.lineJumpInput=String(this.caretLine)
    }
    private formattedText(text:string):string{
        const normalized=text.replace(/\r\n?/g,'\n'),eol=this.lineEnding==='CRLF'?'\r\n':'\n'
        return (this.textEncoding==='UTF-8 BOM'?'\ufeff':'')+normalized.replace(/\n/g,eol)
    }
    private displayText(text:string):string{return text.replace(/^\ufeff/,'')}
    get editorText():string {
        if(!this.pagedText||!this.pageCache.size)return this.content.replace(/\r\n?/g,'\n')
        const parts=this.visibleTextSegments().map(segment=>segment.text),cached=this.textWindowCache
        if(cached&&cached.parts.length===parts.length&&parts.every((part,index)=>part===cached.parts[index]))return cached.text
        const text=parts.join('').replace(/\r\n?/g,'\n')
        this.textWindowCache={parts,text}
        return text
    }
    set editorText(value:string){
        if(!this.pagedText||!this.pageCache.size){this.content=value;return}
        const segments=this.visibleTextSegments().map(segment=>({...segment,normalized:segment.text.replace(/\r\n?/g,'\n')}))
        const previous=segments.map(segment=>segment.normalized).join('')
        if(previous===value)return
        let start=0,end=previous.length,newEnd=value.length
        while(start<end&&start<newEnd&&previous[start]===value[start])start++
        while(end>start&&newEnd>start&&previous[end-1]===value[newEnd-1]){end--;newEnd--}
        const replacement=value.slice(start,newEnd)
        let offset=0
        for(const [position,segment] of segments.entries()){
            const limit=offset+segment.normalized.length
            const insert=start>=offset&&(start<limit||position===segments.length-1)
            if(insert||start<limit&&end>offset){
                // Map the textarea's normalized offsets back to the original line endings.
                const originalOffset=(index:number)=>{
                    if(segment.normalized===segment.text)return index
                    let result=index
                    for(let pair=segment.text.indexOf('\r\n');pair>=0&&pair<result;pair=segment.text.indexOf('\r\n',pair+2))result++
                    return result
                }
                const localStart=originalOffset(Math.max(0,start-offset))
                const localEnd=originalOffset(Math.min(segment.normalized.length,end-offset))
                const content=segment.text.slice(0,localStart)+(insert?replacement:'')+segment.text.slice(localEnd)
                if(segment.index===this.textPage)this.content=content
                else {
                    const {start}=this.pages[segment.index],original=this.pageCache.get(segment.index)!.text
                    if(content===original)this.pageEdits.delete(start)
                    else this.pageEdits.set(start,{start,original,content})
                }
            }
            offset=limit
        }
    }
    async scrollTextWindow(event:Event):Promise<void>{
        if(!this.pagedText||this.textScrollAdjusting||this.loading||this.saving||this.reconnecting||this.saveIssue||this.error)return
        const editor=event.currentTarget as HTMLTextAreaElement
        const wheel=event.type==='wheel'?event as WheelEvent:undefined
        if(wheel&&(wheel.ctrlKey||wheel.shiftKey||Math.abs(wheel.deltaX)>Math.abs(wheel.deltaY)||editor.scrollHeight>editor.clientHeight))return
        const segments=this.visibleTextSegments()
        if(!segments.length)return
        const first=segments[0].index,last=segments[segments.length-1].index
        const down=wheel?wheel.deltaY>0:editor.scrollHeight-editor.scrollTop-editor.clientHeight<editor.clientHeight
        const index=down?last+1:editor.scrollTop<editor.clientHeight?first-1:-1
        if(!this.pages[index])return
        this.rememberPageEdit()
        this.loading=true
        try{
            const page=await this.fetchPage(index)
            if(this.recoveryController.signal.aborted||this.textEditor?.nativeElement!==editor)return
            const oldTop=editor.scrollTop,oldLeft=editor.scrollLeft
            const lineHeight=parseFloat(getComputedStyle(editor).lineHeight)||16
            const selectionStart=editor.selectionStart,selectionEnd=editor.selectionEnd
            // Keep the overlapping text as the scroll anchor while moving the window.
            const center=down?Math.max(this.textPage,index-1):Math.min(this.textPage,index+1)
            this.pageCache.set(index,page)
            this.showPage(center,this.pageCache.get(center)!)
            if(this.search.visible)this.search.changed(0,false)
            const next=this.visibleTextSegments(),nextFirst=next[0].index
            const shifted=(nextFirst>first?segments.filter(segment=>segment.index<nextFirst):
                next.filter(segment=>segment.index<first)).map(segment=>segment.text).join('').replace(/\r\n?/g,'\n')
            const direction=nextFirst>first?-1:1
            this.textScrollAdjusting=true
            requestAnimationFrame(()=>{
                this.textScrollAdjusting=false
                if(this.textEditor?.nativeElement!==editor)return
                editor.setSelectionRange(Math.max(0,selectionStart+direction*shifted.length),Math.max(0,selectionEnd+direction*shifted.length))
                editor.scrollTop=Math.max(0,oldTop+direction*(shifted.split('\n').length-1)*lineHeight)
                editor.scrollLeft=oldLeft
            })
        }catch(error){if(!(error instanceof ReadRestarted)&&!this.recoveryController.signal.aborted)this.error=String(error)}
        finally{this.loading=false}
    }
    async changeTextPage(delta:number):Promise<void>{
        const index=this.textPage+delta
        if(!this.pages[index]||this.loading||this.saving||this.reconnecting||this.saveIssue)return
        const restorePreview=this.markdownPreview
        this.rememberPageEdit()
        this.loading=true;this.error=''
        try{
            this.showPage(index,await this.fetchPage(index))
            if(this.search.visible)this.search.changed()
        }catch(error){if(!(error instanceof ReadRestarted)&&!this.recoveryController.signal.aborted)this.error=String(error)}
        finally{this.loading=false}
        if(restorePreview&&!this.error)await this.toggleMarkdown()
    }
    private async mergeText():Promise<{content:string;original:string;hash?:string}>{
        this.rememberPageEdit()
        const file=await this.workspace.read(this.filePath,this.recoveryController.signal)
        const edits=this.pagedText?[...this.pageEdits.values()].sort((a,b)=>a.start-b.start):
            [{start:0,original:this.original,content:this.content}]
        const parts:string[]=[]
        let end=0
        for(const edit of edits){
            if(edit.start<end||file.content.slice(edit.start,edit.start+edit.original.length)!==edit.original){
                throw new Error(t('文件内容已在外部修改，无法合并尚未加载的内容。'))
            }
            parts.push(file.content.slice(end,edit.start),edit.content)
            end=edit.start+edit.original.length
        }
        parts.push(file.content.slice(end))
        return {content:parts.join(''),original:file.content,hash:file.hash}
    }
    async searchFullText():Promise<void>{
        if(this.loading||this.saving||this.reconnecting||this.saveIssue||!this.pagedText)return
        this.rememberPageEdit()
        this.loading=true;this.error=''
        const query=this.search.state
        let text=''
        const scan=new TextSearch(()=>text,()=>{},()=>undefined,()=>undefined,()=>false)
        Object.assign(scan,query)
        const cached=[...this.pageCache.keys()].filter(index=>index!==this.textPage)
        const current=()=>this.search.visible&&!this.recoveryController.signal.aborted&&JSON.stringify(this.search.state)===JSON.stringify(query)
        const searchPage=async(index:number)=>{
            const page=await this.fetchPage(index)
            if(!current())return true
            text=this.pageEdits.get(this.pages[index].start)?.content??page.text
            scan.changed()
            if(!scan.matches.length)return false
            this.showPage(index,page);this.search.changed()
            return true
        }
        try{
            for(const index of cached)if(await searchPage(index))return
            for(let index=0;index<this.pages.length&&current();index++){
                if(index!==this.textPage&&!cached.includes(index)&&await searchPage(index))return
            }
            if(current())this.error=t('全文未找到匹配内容')
        }
        catch(error){if(!(error instanceof ReadRestarted)&&!this.recoveryController.signal.aborted)this.error=String(error)}
        finally{scan.destroy();this.loading=false}
    }
    markdownPreview=false
    markdown=''
    markdownError=''
    private markdownVersion=0
    private platform: PlatformService
    private app: AppService
    private notifications: NotificationsService
    private removePaneHeader?:()=>void
    private unregisterFile?:()=>void
    private recoveryController=new AbortController()
    private reconnectPool?:FileSessionPool
    reconnecting=false
    get canReconnect():boolean {return this.workspace?.kind==='remote'&&!this.isDiff&&this.initialContent===undefined}
    recoveredEdit?:{content:string;original:string;hash?:string;loadedBytes?:number;hasMoreText?:boolean;needsFileVersion?:boolean}
    recoveredPages?:{pages:EditorPage[];page:number;edits:PageEdit[]}
    initialFind?:FindState
    @ViewChild('textEditor') textEditor?:ElementRef<HTMLTextAreaElement>
    @ViewChild('findInput') findInput?:ElementRef<HTMLInputElement>
    readonly search=new TextSearch(()=>this.editorText,text=>{this.editorText=text},()=>this.textEditor?.nativeElement,
        ()=>this.findInput?.nativeElement,()=>!this.readonly&&!this.viewOnly&&!this.loading&&!this.saving&&!this.reconnecting&&!this.isDiff&&!this.saveIssue,
        ()=>this.clearRenderedPreview())
    @HostListener('keydown',['$event']) searchKey(event:KeyboardEvent):void {
        if(this.isDiff||this.binaryBytes)return
        const editor=this.textEditor?.nativeElement,command=event.ctrlKey||event.metaKey
        if(event.target===editor&&command&&event.key.toLowerCase()==='g'){
            event.preventDefault();event.stopPropagation();this.openLineJump();return
        }
        const redo=event.key.toLowerCase()==='y'||event.key.toLowerCase()==='z'&&event.shiftKey
        if(event.target===editor&&command&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')&&
            (redo?this.multiRedo:this.multiUndo).length){
            event.preventDefault();event.stopPropagation();this.undoMulti(redo);return
        }
        if(event.target===editor&&command&&event.key.toLowerCase()==='d'){
            event.preventDefault();event.stopPropagation();this.addNextOccurrence();return
        }
        this.search.key(event)
    }
    insertTab(event:KeyboardEvent):void{
        if(event.key!=='Tab'||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||this.readonly||this.viewOnly||this.loading||this.saving||this.reconnecting||this.isDiff||this.binaryBytes)return
        const editor=event.currentTarget as HTMLTextAreaElement,start=editor.selectionStart,end=editor.selectionEnd;event.preventDefault()
        this.editorText=editor.value.slice(0,start)+'\t'+editor.value.slice(end)
        this.multiSelections=[];this.multiCursorCount=0
        this.multiUndo=[];this.multiRedo=[]
        queueMicrotask(()=>{editor.setSelectionRange(start+1,start+1);this.search.visible&&this.search.changed();this.updateCaretPosition()})
    }
    editorKeydown(event:KeyboardEvent):void{
        const editor=event.currentTarget as HTMLTextAreaElement
        if(editor.readOnly||this.loading||this.saving||this.reconnecting)return
        const addCursor=event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')
        const editAll=this.multiSelections.length>1&&(event.key==='Enter'||event.key==='Tab'||event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)
        if(this.multiSelections.length&&!addCursor&&!editAll&&!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d')){
            this.multiSelections=[];this.multiCursorCount=0
        }
        if(addCursor){
            event.preventDefault();this.addVerticalCursor(event.key==='ArrowUp'?-1:1);return
        }
        if(event.key==='Enter'&&this.multiSelections.length>1){event.preventDefault();this.applyMultiText('\n');return}
        if(event.key==='Tab'&&this.multiSelections.length>1){event.preventDefault();this.applyMultiText('\t');return}
        if(event.key==='Enter'){event.preventDefault();this.insertIndentedLine(editor);return}
        if(event.key==='Tab'){this.insertTab(event);return}
        if(event.ctrlKey||event.metaKey||event.altKey||event.key.length!==1)return
        const pairs:Record<string,string>={'(':')','[':']','{':'}','"':'"',"'":"'"}
        if(this.multiSelections.length>1&&pairs[event.key]){event.preventDefault();this.applyMultiText(event.key+pairs[event.key],1);return}
        if((event.key==='"'||event.key==="'")&&editor.value[editor.selectionStart]===event.key&&editor.selectionStart===editor.selectionEnd){
            event.preventDefault();editor.setSelectionRange(editor.selectionStart+1,editor.selectionStart+1);this.updateCaretPosition();return
        }
        if(')]}'.includes(event.key)&&editor.value[editor.selectionStart]===event.key&&editor.selectionStart===editor.selectionEnd){
            event.preventDefault();editor.setSelectionRange(editor.selectionStart+1,editor.selectionStart+1);this.updateCaretPosition();return
        }
        if(!pairs[event.key])return
        event.preventDefault()
        const start=editor.selectionStart,end=editor.selectionEnd,source=this.editorText
        this.editorText=source.slice(0,start)+event.key+source.slice(start,end)+pairs[event.key]+source.slice(end)
        this.multiSelections=[];this.multiCursorCount=0
        this.multiUndo=[];this.multiRedo=[]
        queueMicrotask(()=>{editor.setSelectionRange(start+1,start+1+end-start);this.updateCaretPosition()})
    }
    private insertIndentedLine(editor:HTMLTextAreaElement):void{
        const text=this.editorText,start=editor.selectionStart,end=editor.selectionEnd,lineStart=text.lastIndexOf('\n',start-1)+1
        const indent=text.slice(lineStart,start).match(/^[\t ]*/)?.[0]??''
        const before=text.slice(lineStart,start).trimEnd(),after=text.slice(end).trimStart()
        const widths=text.split('\n').map(line=>line.match(/^[\t ]*/)?.[0]??'').filter(value=>value.length)
        const unit=indent.includes('\t')||widths.some(value=>value.includes('\t'))?'\t':' '.repeat(Math.min(...widths.map(value=>value.length),4)||4)
        const opens=/[({\[]$/.test(before),closes=/^[)}\]]/.test(after)
        const inner=opens?indent+unit:closes?indent.slice(0,Math.max(0,indent.length-unit.length)):indent
        let insertion=`\n${inner}`,caret=start+insertion.length
        if(opens&&closes){insertion=`\n${indent+unit}\n${indent}`;caret=start+indent.length+unit.length+1}
        this.editorText=text.slice(0,start)+insertion+text.slice(end)
        this.multiSelections=[];this.multiCursorCount=0
        this.multiUndo=[];this.multiRedo=[]
        queueMicrotask(()=>{editor.setSelectionRange(caret,caret);this.updateCaretPosition()})
    }
    private addNextOccurrence():void{
        const editor=this.textEditor?.nativeElement
        if(!editor)return
        const text=this.editorText,selected=text.slice(editor.selectionStart,editor.selectionEnd)
        const after=text.slice(editor.selectionStart).match(/^[\p{L}\p{N}_$]+/u)?.[0]
        const before=text.slice(0,editor.selectionStart).match(/[\p{L}\p{N}_$]+$/u)?.[0]
        const word=selected||after||before
        if(!word)return
        if(!this.multiSelections.length){
            const start=editor.selectionStart===editor.selectionEnd?after?editor.selectionStart:editor.selectionStart-word.length:editor.selectionStart
            const end=editor.selectionStart===editor.selectionEnd?start+word.length:editor.selectionEnd
            this.multiSelections=[{start,end}];this.multiCursorCount=1
            editor.setSelectionRange(start,end);this.updateCaretPosition();return
        }
        let next=text.indexOf(word,this.multiSelections[this.multiSelections.length-1].end)
        if(next<0)next=text.indexOf(word,0)
        while(next>=0&&this.multiSelections.some(range=>range.start===next))next=text.indexOf(word,next+word.length)
        if(next<0)return
        this.multiSelections.push({start:next,end:next+word.length});this.multiCursorCount=this.multiSelections.length
        editor.setSelectionRange(next,next+word.length);this.updateCaretPosition()
    }
    private addVerticalCursor(direction:number):void{
        const editor=this.textEditor?.nativeElement
        if(!editor)return
        const text=this.editorText,offset=editor.selectionStart,lineStart=text.lastIndexOf('\n',offset-1)+1,column=offset-lineStart
        const previousStart=lineStart?text.lastIndexOf('\n',lineStart-2)+1:-1
        const newline=text.indexOf('\n',lineStart),nextStart=newline<0?-1:newline+1
        const targetStart=direction<0?previousStart:nextStart
        if(targetStart<0||targetStart>=text.length)return
        const lineEnd=text.indexOf('\n',targetStart),target=Math.min(targetStart+column,lineEnd<0?text.length:lineEnd)
        if(!this.multiSelections.length)this.multiSelections=[{start:editor.selectionStart,end:editor.selectionEnd}]
        if(this.multiSelections.some(range=>range.start===target))return
        this.multiSelections.push({start:target,end:target});this.multiCursorCount=this.multiSelections.length
        editor.setSelectionRange(target,target);this.updateCaretPosition()
    }
    private textareaPoint(event:PointerEvent):{line:number;column:number}|undefined{
        const editor=this.textEditor?.nativeElement
        if(!editor||this.softWrap)return
        const rect=editor.getBoundingClientRect(),style=getComputedStyle(editor),fontSize=parseFloat(style.fontSize)||12
        const rowHeight=parseFloat(style.lineHeight)||fontSize*1.65,charWidth=fontSize*.6
        const line=Math.max(0,Math.min(this.editorText.split('\n').length-1,Math.floor((event.clientY-rect.top-parseFloat(style.paddingTop)+editor.scrollTop)/rowHeight)))
        const column=Math.max(0,Math.floor((event.clientX-rect.left-parseFloat(style.paddingLeft)+editor.scrollLeft)/charWidth))
        return {line,column}
    }
    columnPointerDown(event:PointerEvent):void{
        if(!event.altKey||!event.shiftKey||this.readonly||this.viewOnly||this.loading||this.saving)return
        const point=this.textareaPoint(event),editor=event.currentTarget as HTMLTextAreaElement
        if(!point)return
        event.preventDefault();editor.focus();editor.setPointerCapture(event.pointerId)
        this.columnDragAnchor=point;this.setColumnSelection(point)
    }
    columnPointerMove(event:PointerEvent):void{
        if(!this.columnDragAnchor)return
        const point=this.textareaPoint(event)
        if(point)this.setColumnSelection(point)
    }
    columnPointerUp():void{this.columnDragAnchor=undefined}
    private setColumnSelection(point:{line:number;column:number}):void{
        const editor=this.textEditor?.nativeElement
        if(!editor||!this.columnDragAnchor)return
        const lines=this.editorText.split('\n'),starts:number[]=[];let offset=0
        for(const line of lines){starts.push(offset);offset+=line.length+1}
        const anchor=this.columnDragAnchor,first=Math.min(anchor.line,point.line),last=Math.max(anchor.line,point.line)
        const left=Math.min(anchor.column,point.column),right=Math.max(anchor.column,point.column)
        this.multiSelections=[]
        for(let line=first;line<=last;line++){
            const start=starts[line]+Math.min(left,lines[line].length),end=starts[line]+Math.min(right,lines[line].length)
            this.multiSelections.push({start,end})
        }
        this.multiCursorCount=this.multiSelections.length
        const active=this.multiSelections[this.multiSelections.length-1]
        editor.setSelectionRange(active.start,active.end);this.updateCaretPosition()
    }
    handleMultiInput(event:InputEvent):void{
        if(this.multiSelections.length<2){this.multiSelections=[];this.multiCursorCount=0;return}
        const editor=event.currentTarget as HTMLTextAreaElement
        let replacement=event.data
        if(event.inputType==='insertFromPaste')replacement=event.dataTransfer?.getData('text/plain')??''
        const ranges=[...this.multiSelections]
        if(event.inputType==='deleteContentBackward'||event.inputType==='deleteContentForward'){
            for(const range of ranges)if(range.start===range.end){
                if(event.inputType==='deleteContentBackward')range.start=Math.max(0,range.start-1)
                else range.end++
            }
            replacement=''
        }else if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph')replacement='\n'
        else if(!event.inputType.startsWith('insert'))return
        event.preventDefault()
        this.applyMultiText(replacement??'')
    }
    pasteMulti(event:ClipboardEvent):void{
        if(this.multiSelections.length<2)return
        event.preventDefault();this.applyMultiText(event.clipboardData?.getData('text/plain')??'')
    }
    copyMulti(event:ClipboardEvent):void{
        if(this.multiSelections.length<2)return
        const text=this.editorText
        event.clipboardData?.setData('text/plain',this.multiSelections.map(range=>text.slice(range.start,range.end)).join('\n'))
        event.preventDefault()
    }
    cutMulti(event:ClipboardEvent):void{
        if(this.multiSelections.length<2)return
        this.copyMulti(event);this.applyMultiText('')
    }
    private applyMultiText(replacement:string,caretOffset=replacement.length):void{
        const editor=this.textEditor?.nativeElement,ranges=[...this.multiSelections]
        if(!editor||ranges.length<2)return
        const text=this.editorText,active=ranges[ranges.length-1]
        this.multiUndo.push({text,start:editor.selectionStart,end:editor.selectionEnd});this.multiRedo=[]
        let next=text
        for(const range of [...ranges].sort((a,b)=>b.start-a.start))next=next.slice(0,range.start)+replacement+next.slice(range.end)
        const shift=ranges.filter(range=>range.start<active.start).reduce((sum,range)=>sum+replacement.length-(range.end-range.start),0)
        const caret=active.start+shift+caretOffset
        this.editorText=next;this.multiSelections=[];this.multiCursorCount=0
        queueMicrotask(()=>{editor.setSelectionRange(caret,caret);this.updateCaretPosition()})
    }
    editorInput():void{
        this.updateCaretPosition()
        if(!this.multiSelections.length){this.multiUndo=[];this.multiRedo=[]}
    }
    private undoMulti(redo:boolean):void{
        const editor=this.textEditor?.nativeElement,from=redo?this.multiRedo:this.multiUndo,to=redo?this.multiUndo:this.multiRedo
        const previous=from.pop()
        if(!editor||!previous)return
        to.push({text:this.editorText,start:editor.selectionStart,end:editor.selectionEnd})
        this.editorText=previous.text;editor.setSelectionRange(previous.start,previous.end);this.multiSelections=[];this.multiCursorCount=0
        this.updateCaretPosition()
    }
    syncEditorScroll(event:Event):void{
        const editor=event.currentTarget as HTMLTextAreaElement
        if(this.lineGutter)this.lineGutter.nativeElement.scrollTop=editor.scrollTop
        if(this.editorOverlay){this.editorOverlay.nativeElement.scrollTop=editor.scrollTop;this.editorOverlay.nativeElement.scrollLeft=editor.scrollLeft}
        this.updateCaretPosition();void this.scrollTextWindow(event)
    }
    openLineJump():void{this.lineJumpVisible=true;setTimeout(()=>this.lineJumpInputElement?.nativeElement.focus(),0)}
    async jumpToLine():Promise<void>{
        const target=Math.max(1,Math.floor(Number(this.lineJumpInput)||1));this.lineJumpVisible=false
        if(this.loading||this.saving)return
        if(!this.pagedText){
            const lines=this.content.split('\n');let offset=0
            for(let i=0;i<Math.min(target-1,lines.length-1);i++)offset+=lines[i].length+1
            this.textEditor?.nativeElement.setSelectionRange(offset,offset);this.updateCaretPosition();this.textEditor?.nativeElement.focus();return
        }
        this.rememberPageEdit();this.loading=true
        try{
            let index=0,page:PageText|undefined
            while(index<this.pages.length){
                page=await this.fetchPage(index)
                const content=this.pageEdits.get(this.pages[index].start)?.content??page.text
                const end=this.lineStart(index)+(content.match(/\n/g)?.length??0)
                if(target<=end||!page.more)break
                index++
            }
            if(!page)return
            this.showPage(index,page)
            const lines=this.content.split('\n');let local=0
            for(let i=0;i<Math.min(target-this.lineStart(index)-1,lines.length-1);i++)local+=lines[i].length+1
            requestAnimationFrame(()=>{const editor=this.textEditor?.nativeElement;if(editor){const prefix=this.visibleTextSegments().filter(segment=>segment.index<index).reduce((sum,segment)=>sum+segment.text.length,0);editor.setSelectionRange(prefix+local,prefix+local);editor.focus();this.updateCaretPosition()}})
        }catch(error){if(!(error instanceof ReadRestarted))this.error=String(error)}finally{this.loading=false}
    }
    constructor (private injector: Injector) {
        super(injector)
        this.platform = injector.get(PlatformService)
        this.app = injector.get(AppService)
        this.notifications = injector.get(NotificationsService)
    }
    get dirty (): boolean {
        return !this.readonly&&(this.content!==this.original||
            [...this.pageEdits.keys()].some(start=>start!==this.pages[this.textPage]?.start)||
            this.lineEnding!==this.savedLineEnding||this.textEncoding!==this.savedTextEncoding)
    }
    get saveIssue (): {message:string;busy:boolean}|undefined {return this.workspace?.saveIssue?.(this.filePath)}
    get isDiff (): boolean { return this.diffPatch !== undefined }
    get isMarkdown():boolean {return !this.isDiff&&!this.binaryBytes&&previewKind(this.filePath)==='markdown'}
    get isCsv():boolean {return !this.isDiff&&!this.binaryBytes&&previewKind(this.filePath)==='csv'}
    get canToggleContentMode():boolean{return !this.isDiff&&!this.binaryBytes&&!this.readonly&&this.initialContent===undefined}
    async toggleContentMode(event?:MouseEvent):Promise<void>{
        event?.preventDefault();event?.stopPropagation()
        if(!this.canToggleContentMode||this.loading||this.saving||this.reconnecting)return
        if(this.markdownPreview){this.clearRenderedPreview();this.viewOnly=false;return}
        if(this.viewOnly){this.viewOnly=false;return}
        if(this.isMarkdown||this.isCsv){
            this.viewOnly=true
            await this.toggleMarkdown()
            return
        }
        this.viewOnly=true
    }
    private clearRenderedPreview():void{
        this.markdownPreview=false;this.markdownVersion++;this.markdown='';this.markdownError=''
        this.csv={rows:[],columns:0,truncated:false};this.csvFiltered=[]
    }
    csv:CsvPreview={rows:[],columns:0,truncated:false}
    csvDelimiter='auto'
    csvHeader=true
    csvQuery=''
    csvPage=1
    csvFiltered:Array<{values:string[];index:number}>=[]
    get csvHeaders(){return Array.from({length:this.csv.columns},(_,index)=>this.csvHeader?(this.csv.rows[0]?.[index]||t`列 ${index+1}`):t`列 ${index+1}`)}
    get csvPages(){return Math.max(1,Math.ceil(this.csvFiltered.length/100))}
    get csvPageRows(){return this.csvFiltered.slice((this.csvPage-1)*100,this.csvPage*100)}
    parseTable():void{
        try{
            const delimiter=this.csvDelimiter==='auto'?(this.filePath.toLowerCase().endsWith('.tsv')?'\t':detectDelimiter(this.content)):this.csvDelimiter
            this.csv=parseCsv(this.content,delimiter);this.markdownError='';this.filterTable()
        }catch(error){this.markdownError=String(error)}
    }
    filterTable():void{
        const query=this.csvQuery.toLocaleLowerCase()
        this.csvFiltered=this.csv.rows.flatMap((values,index)=>index===0&&this.csvHeader||
            query&&!values.some(value=>value.toLocaleLowerCase().includes(query))?[]:[{values,index:index+1}])
        this.csvPage=1
    }
    changeCsvPage(delta:number):void{this.csvPage=Math.max(1,Math.min(this.csvPages,this.csvPage+delta))}
    async toggleMarkdown():Promise<void> {
        if((!this.isMarkdown&&!this.isCsv)||this.loading||this.saving)return
        if(this.markdownPreview){this.clearRenderedPreview();return}
        const version=++this.markdownVersion
        this.markdownPreview=true;this.markdownError=''
        this.search.close()
        if(this.isCsv){this.parseTable();return}
        const content=this.content,path=this.filePath,workspace=this.workspace
        const current=()=>this.markdownPreview&&version===this.markdownVersion&&!this.recoveryController.signal.aborted
        try{
            this.markdown=renderMarkdown(content)
            const assets=new Map<string,string>();let total=0
            for(const href of markdownImages(content)){
                const asset=relativePreviewAsset(path,href,workspace.kind)
                if(!asset||!imageMime(asset)||imageMime(asset)==='image/tiff'||!workspace.readBytes)continue
                try{
                    const bytes=await workspace.readBytes(asset,4*1024*1024,this.recoveryController.signal)
                    if(!current())return
                    total+=bytes.length;if(total>16*1024*1024)break
                    assets.set(href,`data:${imageMime(asset)};base64,${Buffer.from(bytes).toString('base64')}`)
                }catch{if(!current())return}
            }
            if(current())this.markdown=renderMarkdown(content,assets)
        }catch(error){if(current())this.markdownError=String(error)}
    }
    markdownClick(event:MouseEvent):void {
        const anchor=(event.target as Element)?.closest?.('a');if(!anchor)return
        event.preventDefault();const href=anchor.getAttribute('href')??''
        if(/^(?:https?:|mailto:)/i.test(href))void this.platform.openExternal(href)
        else if(href.startsWith('#')){
            let id=href.slice(1);try{id=decodeURIComponent(id)}catch{return}
            for(const heading of Array.from((event.currentTarget as HTMLElement).querySelectorAll('[id]')))
                if(heading.id===id){heading.scrollIntoView();break}
        }
    }
    get waitingForConnection (): boolean { return !this.recoveredEdit && !this.recoveredPages && !this.isDiff && this.initialContent===undefined && Boolean(this.workspace?.waitForConnection) }
    get connectionStatus (): string|undefined { return this.workspace?.connectionStatus }
    private retainFileContent=true
    private fileContentReleased=false
    private restoreRenderedView=false
    private retentionQueued=false
    private releaseTimer?:ReturnType<typeof setTimeout>
    setFileContentRetained(retained:boolean):void {
        this.retainFileContent=retained
        if(retained&&this.releaseTimer!==undefined){
            clearTimeout(this.releaseTimer)
            this.releaseTimer=undefined
            this.retentionQueued=false
        }
        this.scheduleFileRetention()
    }
    private scheduleFileRetention():void {
        if(this.retentionQueued||this.loading||this.saving||this.reconnecting||this.recoveryController.signal.aborted||
            this.initialContent!==undefined||this.dirty||this.saveIssue||
            this.retainFileContent!==this.fileContentReleased)return
        this.retentionQueued=true
        const reconcile=()=>{
            this.releaseTimer=undefined
            this.retentionQueued=false
            if(this.loading||this.saving||this.reconnecting||this.recoveryController.signal.aborted||
                this.dirty||this.saveIssue||this.retainFileContent!==this.fileContentReleased)return
            if(this.retainFileContent){void this.restoreFileContent();return}
            this.fileContentReleased=true
            this.restoreRenderedView=this.markdownPreview
            this.clearRenderedPreview()
            this.resetPages();this.needsFileVersion=false
            this.content='';this.original='';this.hash=undefined
            this.binaryBytes=undefined;this.binaryPage=0;this.hexWindowCache=undefined;this.diff=undefined
            this.search.changed()
        }
        if(this.retainFileContent)queueMicrotask(reconcile)
        else this.releaseTimer=setTimeout(reconcile,filePaneReleaseDelayMs)
    }
    private async restoreFileContent():Promise<void>{
        this.fileContentReleased=false
        this.loading=true;this.error=''
        try{
            if(this.isDiff)this.updateDiff(this.diffPatch!)
            else {
                await this.readFile()
                this.original=this.content
                if(this.search.visible)this.search.changed()
            }
        }catch(error){
            if(!this.recoveryController.signal.aborted){this.error=String(error);this.readonly=true}
        }finally{this.loading=false}
        if(this.restoreRenderedView&&!this.error&&this.retainFileContent)void this.toggleMarkdown()
        this.scheduleFileRetention()
    }
    get visibleHunks (): DiffHunk[] { return this.activeHunk < 0 ? this.diff?.hunks ?? [] : this.diff?.hunks.slice(this.activeHunk,this.activeHunk+1) ?? [] }
    nextHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk+1)%this.diff.hunks.length }
    previousHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk<0?this.diff.hunks.length-1:(this.activeHunk-1+this.diff.hunks.length)%this.diff.hunks.length) }
    ngDoCheck (): void {
        this.scheduleFileRetention()
        const title=`${this.dirty||this.saveIssue?'● ':''}${this.isDiff?'Diff':this.readonly?'Read-only':this.waitingForConnection?'Waiting':'Edit'} · ${this.filePath}`
        if(this.title!==title)this.setTitle(title)
    }
    updateDiff(patch:string):void {
        const changed=this.diffPatch!==patch
        this.diffPatch=patch;this.readonly=true;this.error=''
        if(changed)this.activeHunk=-1
        if(this.fileContentReleased)return
        try{this.diff=parseDiff(patch)}
        catch(error){this.diff=undefined;this.error=String(error)}
    }
    async ngOnInit (): Promise<void> {
        this.setTitle(`${this.isDiff?'Diff':this.readonly?'Read-only':'Edit'} · ${this.filePath}`)
        try {
            if (this.isDiff) { this.updateDiff(this.diffPatch!); return }
            this.workspace=await resolveFileWorkspace(this.workspace,this.recoveryController.signal)
            if(this.recoveredPages){
                const file=await this.workspace.read(this.filePath,this.recoveryController.signal)
                let content=file.content,end=0
                const edits=[...this.recoveredPages.edits].sort((a,b)=>a.start-b.start)
                for(const edit of edits){
                    if(edit.start<end||file.content.slice(edit.start,edit.start+edit.original.length)!==edit.original)throw new Error(t('文件内容已在外部修改，无法合并尚未加载的内容。'))
                    content=content.slice(0,edit.start)+edit.content+content.slice(edit.start+edit.original.length)
                    end=edit.start+edit.original.length
                }
                this.setTextFormat(new TextEncoder().encode(file.content))
                this.content=content.replace(/\r\n?/g,'\n');this.hash=file.hash;this.original=file.content.replace(/\r\n?/g,'\n')
                this.recoveredPages=undefined
                return
            }
            if(this.recoveredEdit){Object.assign(this,this.recoveredEdit);return}
            else if (this.initialContent !== undefined) { this.content = this.initialContent; this.readonly = true }
            else {
                const readStarted=performance.now()
                logFileRecovery('editor-read-start',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace)})
                await this.readFile()
                logFileRecovery('editor-read-ready',{filePath:this.filePath,elapsedMs:Math.round((performance.now()-readStarted)*100)/100,mode:'full'})
            }
            this.original = this.content
        } catch (error) {
            if(error instanceof ReadRestarted){this.original=this.content;return}
            logFileRecovery('editor-load-error',{filePath:this.filePath,cancelled:this.recoveryController.signal.aborted,error:String(error)})
            this.error = String(error); this.readonly = true
        }
        finally {
            this.loading = false
            if(this.renderOnOpen&&!this.error&&!this.initialFind&&!this.recoveryController.signal.aborted)void this.toggleMarkdown()
            if(this.initialFind)this.search.restore(this.initialFind)
            if(!this.recoveryController.signal.aborted&&!this.isDiff&&this.initialContent===undefined&&!this.waitingForConnection)this.unregisterFile=registerOpenedWorkspaceFile({workspace:this.workspace,filePath:this.filePath,refresh:()=>this.reloadOpenFile()})
        }
    }
    async reloadOpenFile (): Promise<void> {
        if(!this.retainFileContent||this.fileContentReleased||this.loading||this.saving||(this.readonly&&!this.error)||this.dirty||this.saveIssue)return
        if(this.needsFileVersion){
            this.loading=true
            try{await this.readFile();this.original=this.content;this.error='';if(this.search.visible)this.search.changed()}
            catch(error){if(!this.recoveryController.signal.aborted)this.error=String(error)}
            finally{this.loading=false}
            return
        }
        const original=this.original
        try {
            const file=await this.workspace.read(this.filePath)
            if(this.loading||this.saving||(this.readonly&&!this.error)||this.dirty||this.saveIssue||this.original!==original)return
            this.content=file.content;this.original=file.content;this.hash=file.hash
            this.hasMoreText=false;this.needsFileVersion=false
            this.error='';this.readonly=false
            if(this.markdownPreview){this.markdownPreview=false;await this.toggleMarkdown()}
        } catch(error) {this.error=String(error)}
    }
    private async closeMissingFile():Promise<void> {
        if(this.recoveryController.signal.aborted)return
        this.notifications.info(t('远端文件路径不存在'),this.filePath)
        if(this.app.tabs.includes(this))await this.app.closeTab(this,false)
        else this.destroy()
    }
    async reconnectFile():Promise<void> {
        if(!this.canReconnect||this.reconnecting||this.loading||this.saving)return
        const token=fileWorkspaceToken(this.workspace)
        if(!token)return
        this.reconnecting=true
        const preserve=this.dirty||!!this.saveIssue
        try{
            this.reconnectPool??=new FileSessionPool(this.app,this.injector)
            const session=await this.reconnectPool.get(token,true)
            if(this.recoveryController.signal.aborted)return
            if(!session)throw new Error(t('请先重新连接原 SSH 终端，再重试打开文件'))
            const replacement=remoteWorkspace(session,token.root)
            const target=posix.resolve(token.root,this.filePath)
            const missing=(error:unknown)=>{
                const value=error as {code?:unknown;message?:string}|null
                return value?.code==='ENOENT'||value?.code===2||/no such file or directory/i.test(value?.message??String(error))
            }
            try{
                const sftp=await optionalSftp(session)
                if(sftp)await sftp.stat(target)
                else {
                    const result=await replacement.run(`LC_ALL=C stat -- ${shellQuote(target)}`,this.recoveryController.signal)
                    if(result.exitCode!==0)throw new Error(result.stderr||t('无法读取远端文件的修改时间或大小'))
                }
            }catch(error){
                if(!missing(error))throw error
                await this.closeMissingFile()
                return
            }
            if(this.recoveryController.signal.aborted)return
            this.workspace=replacement
            if(!preserve){
                this.binaryBytes=undefined;this.binaryPage=0
                await this.readFile()
                this.original=this.content
                if(!this.binaryBytes)this.readonly=this.largeTextReadOnly
                this.markdownPreview=false;this.markdownVersion++
            }
            this.unregisterFile?.()
            this.unregisterFile=registerOpenedWorkspaceFile({workspace:this.workspace,filePath:this.filePath,refresh:()=>this.reloadOpenFile()})
            this.error=''
        }catch(error){if(!this.recoveryController.signal.aborted)this.error=String(error)}
        finally{this.reconnecting=false}
    }
    async getRecoveryToken(options?:GetRecoveryTokenOptions):Promise<RecoveryToken|null> {
        const workspace=this.workspace&&fileWorkspaceToken(this.workspace)
        if(!workspace)return null
        const state:Record<string,unknown>={arwPaneLayout:this.arwPaneLayout,readonly:this.readonly,initialContent:this.initialContent,diffPatch:this.diffPatch,
            diffLabel:this.diffLabel,diffDescription:this.diffDescription,diffStaged:this.diffStaged,diffMode:this.diffMode,
            viewOnly:this.viewOnly,renderOnOpen:this.markdownPreview,softWrap:this.softWrap,lineEnding:this.lineEnding,
            textEncoding:this.textEncoding,savedLineEnding:this.savedLineEnding,savedTextEncoding:this.savedTextEncoding}
        if(options?.includeState!==false&&this.dirty){
            if(this.pagedText){
                this.rememberPageEdit()
                state.recoveredPages={pages:this.pages,page:this.textPage,edits:[...this.pageEdits.values()]}
            }else state.recoveredEdit={content:this.content,original:this.original,hash:this.hash,...(this.needsFileVersion&&this.recoveredEdit)}
        }
        if(this.saveIssue){state.initialContent=this.content;delete state.recoveredEdit}
        return {type:'arw-editor',workspace,filePath:this.filePath,state}
    }
    ngAfterViewInit (): void { this.removePaneHeader=addFileCloseButton(this,this.app,error=>this.notifications.error(t('关闭文件失败'),String(error)));this.updateCaretPosition() }
    ngOnDestroy (): void { clearTimeout(this.releaseTimer);this.removePaneHeader?.();this.search.destroy();this.recoveryController.abort();this.reconnectPool?.dispose();this.unregisterFile?.(); super.ngOnDestroy() }
    saveKey (event: Event): void { event.preventDefault(); void this.save() }
    private async checkWriteLimit(content?:string):Promise<void>{
        if(content!==undefined)checkFileWriteSize(this.workspace.kind,Buffer.byteLength(content))
        const size=await this.workspace.fileSize?.(this.filePath,this.recoveryController.signal)
        if(size!==undefined)checkFileWriteSize(this.workspace.kind,size)
    }
    async save (): Promise<void> {
        if (this.readonly || this.reconnecting || this.saving || this.loading || !this.dirty || this.saveIssue) return
        this.saving = true; this.error = ''
        try {
            await this.checkWriteLimit()
            if(this.pagedText){
                const merged=await this.mergeText()
                const formatted=this.formattedText(merged.content)
                checkFileWriteSize(this.workspace.kind,Buffer.byteLength(formatted))
                try{
                    await this.workspace.write(this.filePath,formatted,merged.hash)
                }catch(error){
                    if(this.saveIssue){
                        // An uncertain remote write needs the exact payload for an explicit retry.
                        Object.assign(this,merged)
                        this.resetPages();this.needsFileVersion=false
                    }
                    if(this.workspace.kind==='remote'&&isFileMissing(error)){await this.closeMissingFile();return}
                    throw error
                }
                this.resetPages();this.needsFileVersion=false
                this.content='';this.original=''
                await this.readFile();this.original=this.content
                if(this.search.visible)this.search.changed()
                return
            }
            if(this.needsFileVersion){Object.assign(this,await this.mergeText());this.needsFileVersion=false;this.hasMoreText=false}
            const content = this.formattedText(this.content)
            checkFileWriteSize(this.workspace.kind,Buffer.byteLength(content))
            let file
            try { file=await this.workspace.write(this.filePath,content,this.hash) }
            catch(error){
                if(this.workspace.kind==='remote'&&isFileMissing(error)){await this.closeMissingFile();return}
                if(!isFileConflict(error)||this.saveIssue)throw error
                if(this.recoveryController.signal.aborted)return
                const choice=await this.platform.showMessageBox({type:'warning',
                    message:t('文件已被修改，是否覆盖？'),detail:this.filePath,
                    buttons:[t('否，刷新内容'),t('是，覆盖')],defaultId:0,cancelId:0})
                if(this.recoveryController.signal.aborted)return
                if(choice.response!==1){
                    file=await this.workspace.read(this.filePath)
                    this.content=file.content;this.original=file.content;this.hash=file.hash
                    this.markdownPreview=false;this.markdownVersion++
                    if(this.search.visible)this.search.changed()
                    return
                }
                file=await this.workspace.write(this.filePath,content)
            }
            this.hash=file.hash;this.content=this.displayText(content).replace(/\r\n?/g,'\n');this.original=this.content
            this.savedLineEnding=this.lineEnding;this.savedTextEncoding=this.textEncoding
        }
        catch (error) {
            if(this.workspace.kind==='remote'&&isFileMissing(error)){await this.closeMissingFile();return}
            this.error=String(error)
        }
        finally { this.saving = false }
    }
    async verifySave (): Promise<void> {
        if(this.saving||this.loading||!this.saveIssue||this.saveIssue.busy||!this.workspace.verifySave)return
        this.saving=true;this.error=''
        try {
            const file=await this.workspace.verifySave(this.filePath)
            this.hash=file.hash;this.original=file.content
        }catch(error){this.error=String(error)}
        finally{this.saving=false}
    }
    async reloadSave (): Promise<void> {
        if(this.saving||this.loading||this.saveIssue?.busy||!this.workspace.reloadSave)return
        const confirmation=await this.platform.showMessageBox({type:'warning',message:t('重新加载会放弃本地修改，是否继续？'),buttons:[t('取消'),t('重新加载')],defaultId:0,cancelId:0})
        if(confirmation.response!==1)return
        this.saving=true;this.error=''
        try {
            const file=await this.workspace.reloadSave(this.filePath)
            this.content=file.content;this.original=file.content;this.hash=file.hash
            this.markdownPreview=false;this.markdownVersion++
        }catch(error){this.error=String(error)}
        finally{this.saving=false}
    }
    async retrySave (): Promise<void> {
        if(this.readonly||this.saving||this.loading||!this.saveIssue||this.saveIssue.busy||!this.workspace.retrySave)return
        const confirmation=await this.platform.showMessageBox({type:'warning',message:t('再次保存将用本地内容覆盖远端文件，是否继续？'),buttons:[t('取消'),t('再次保存')],defaultId:0,cancelId:0})
        if(confirmation.response!==1)return
        this.saving=true;this.error=''
        const content=this.formattedText(this.content)
        try {
            await this.checkWriteLimit(content)
            const file=await this.workspace.retrySave(this.filePath,content)
            this.hash=file.hash;this.content=this.displayText(content).replace(/\r\n?/g,'\n');this.original=this.content
            this.savedLineEnding=this.lineEnding;this.savedTextEncoding=this.textEncoding
        }catch(error){this.error=String(error)}
        finally{this.saving=false}
    }
    async canClose (): Promise<boolean> {
        if (this.saving) return false
        if (!this.dirty && !this.saveIssue) return true
        return (await this.platform.showMessageBox({ type: 'warning', message: t('文件尚未保存，放弃修改并关闭？'), buttons: [t('取消'), t('放弃修改')], defaultId: 0, cancelId: 0 })).response === 1
    }
}
