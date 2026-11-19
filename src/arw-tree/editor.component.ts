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
interface EditorPage {offset:number;start:number}
interface PageText {text:string;length:number;more:boolean}
interface PageEdit {start:number;original:string;content:string}

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
    private async readFile():Promise<void> {
        const signal=this.recoveryController.signal
        const size=await this.workspace.fileSize?.(this.filePath,signal)??0
        checkFileReadSize(this.workspace.kind,size)
        this.largeTextReadOnly=size>fileWriteLimit(this.workspace.kind)
        this.readonly=this.largeTextReadOnly
        try {
            if(this.workspace.readByteRange){
                const bytes=await this.workspace.readByteRange(this.filePath,0,editorChunkBytes+1,this.recoveryController.signal,true)
                if(bytes.length>editorChunkBytes&&!bytes.includes(0)){
                    try{
                        const chunk=this.decodeEditorChunk(bytes,0)
                        this.resetPages()
                        this.pages=[{offset:0,start:0}]
                        this.showPage(0,{...chunk,more:true})
                        this.needsFileVersion=true;this.hash=undefined
                        return
                    }catch(error){if(!(error instanceof TypeError))throw error}
                }
            }
            const file=await this.workspace.read(this.filePath,this.recoveryController.signal)
            this.content=file.content;this.hash=file.hash
        }catch(error){
            if(!isBinaryFileError(error)||!this.workspace.readBytes)throw error
            this.binaryBytes=await this.workspace.readBytes(this.filePath,fileReadLimit(this.workspace.kind),this.recoveryController.signal)
            this.binaryPage=0;this.readonly=true;this.content='';this.hash=undefined
        }
        this.resetPages();this.needsFileVersion=false
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
        if(more&&!next)this.pages[index+1]={offset:offset+chunk.length,start:start+chunk.text.length}
        return {...chunk,more}
    }
    private showPage(index:number,page:PageText):void {
        const {offset,start}=this.pages[index]
        if(page.more&&!this.pages[index+1])this.pages[index+1]={offset:offset+page.length,start:start+page.text.length}
        this.textPage=index;this.hasMoreText=page.more
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
    get editorText():string {
        if(!this.pagedText||!this.pageCache.size)return this.content
        const parts=this.visibleTextSegments().map(segment=>segment.text),cached=this.textWindowCache
        if(cached&&cached.parts.length===parts.length&&parts.every((part,index)=>part===cached.parts[index]))return cached.text
        const text=parts.join('')
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
        }catch(error){if(!this.recoveryController.signal.aborted)this.error=String(error)}
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
        }catch(error){if(!this.recoveryController.signal.aborted)this.error=String(error)}
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
        catch(error){if(!this.recoveryController.signal.aborted)this.error=String(error)}
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
    @HostListener('keydown',['$event']) searchKey(event:KeyboardEvent):void {if(!this.isDiff&&!this.binaryBytes)this.search.key(event)}
    insertTab(event:KeyboardEvent):void{
        if(event.key!=='Tab'||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||this.readonly||this.viewOnly||this.loading||this.saving||this.reconnecting||this.isDiff||this.binaryBytes)return
        const editor=event.currentTarget as HTMLTextAreaElement,start=editor.selectionStart,end=editor.selectionEnd;event.preventDefault()
        this.editorText=editor.value.slice(0,start)+'\t'+editor.value.slice(end)
        queueMicrotask(()=>{editor.setSelectionRange(start+1,start+1);this.search.visible&&this.search.changed()})
    }
    constructor (private injector: Injector) {
        super(injector)
        this.platform = injector.get(PlatformService)
        this.app = injector.get(AppService)
        this.notifications = injector.get(NotificationsService)
    }
    get dirty (): boolean {
        return !this.readonly&&(this.content!==this.original||
            [...this.pageEdits.keys()].some(start=>start!==this.pages[this.textPage]?.start))
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
            if(this.recoveredPages&&this.workspace.readByteRange){
                const {pages,page,edits}=this.recoveredPages
                this.pages=pages;this.pageEdits=new Map(edits.map(edit=>[edit.start,edit]))
                this.needsFileVersion=true;this.textPage=page
                const edit=this.pageEdits.get(pages[page].start)
                if(edit){
                    this.original=edit.original;this.content=edit.content;this.hasMoreText=Boolean(pages[page+1])
                }else this.showPage(page,await this.fetchPage(page))
                return
            }
            if(this.recoveredEdit){Object.assign(this,this.recoveredEdit);return}
            else if (this.initialContent !== undefined) { this.content = this.initialContent; this.readonly = true }
            else {
                logFileRecovery('editor-read-start',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace)})
                await this.readFile()
                logFileRecovery('editor-read-ready',{filePath:this.filePath})
            }
            this.original = this.content
        } catch (error) {
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
            viewOnly:this.viewOnly,renderOnOpen:this.markdownPreview}
        if(options?.includeState!==false&&this.dirty){
            if(this.pagedText){
                this.rememberPageEdit()
                state.recoveredPages={pages:this.pages,page:this.textPage,edits:[...this.pageEdits.values()]}
            }else state.recoveredEdit={content:this.content,original:this.original,hash:this.hash,...(this.needsFileVersion&&this.recoveredEdit)}
        }
        if(this.saveIssue){state.initialContent=this.content;delete state.recoveredEdit}
        return {type:'arw-editor',workspace,filePath:this.filePath,state}
    }
    ngAfterViewInit (): void { this.removePaneHeader=addFileCloseButton(this,this.app,error=>this.notifications.error(t('关闭文件失败'),String(error))) }
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
                checkFileWriteSize(this.workspace.kind,Buffer.byteLength(merged.content))
                try{
                    await this.workspace.write(this.filePath,merged.content,merged.hash)
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
            const content = this.content
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
            this.hash=file.hash;this.original=content
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
        const content=this.content
        try {
            await this.checkWriteLimit(content)
            const file=await this.workspace.retrySave(this.filePath,content)
            this.hash=file.hash;this.original=content
        }catch(error){this.error=String(error)}
        finally{this.saving=false}
    }
    async canClose (): Promise<boolean> {
        if (this.saving) return false
        if (!this.dirty && !this.saveIssue) return true
        return (await this.platform.showMessageBox({ type: 'warning', message: t('文件尚未保存，放弃修改并关闭？'), buttons: [t('取消'), t('放弃修改')], defaultId: 0, cancelId: 0 })).response === 1
    }
}
