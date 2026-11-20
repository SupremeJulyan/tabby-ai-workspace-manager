import { optionalSftp } from '../adapters/optional-sftp'
import { checkFileReadSize, checkFileWriteSize, fileReadLimit, fileWriteLimit } from '../shared/file-size-policy'
import { posix } from 'node:path'
import { shellQuote } from '../shared/shell-quote'
import { FileSessionPool } from '../services/file-session-pool'
import { remoteWorkspace } from '../adapters/remote-workspace'
import { isBinaryFileError, formatHexPage } from '../shared/binary-file'
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
    softWrap=false
    lineEnding:'LF'|'CRLF'='LF'
    textEncoding:'UTF-8'|'UTF-8 BOM'='UTF-8'
    private savedLineEnding:'LF'|'CRLF'='LF'
    private savedTextEncoding:'UTF-8'|'UTF-8 BOM'='UTF-8'
    get editorText():string{return this.content.replace(/\r\n?/g,'\n')}
    set editorText(value:string){this.content=value}
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
    get binaryContent():string {
        if(!this.binaryBytes)return ''
        const pages:string[]=[]
        for(let index=0;index<Math.ceil(this.binaryBytes.length/4096);index++){
            pages.push(formatHexPage(this.binaryBytes,index))
        }
        return pages.join('\n')
    }
    private async readFile():Promise<void>{
        let attempt=0
        while(true){
            try{await this.readFileOnce();return}
            catch(error){
                if(!this.isRemoteReadRace(error)||this.dirty||this.recoveryController.signal.aborted)throw error
                logFileRecovery('editor-read-retry',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),attempt:++attempt,error:String(error)})
                this.binaryBytes=undefined;this.content='';this.original=''
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
        this.binaryBytes=undefined;this.content='';this.original='';this.error=''
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
            this.readonly=true;this.content='';this.hash=undefined
            outcome='binary'
            logStep('binary-content-ready',stepStarted,{bytes:this.binaryBytes.length})
        }finally{
            logFileRecovery('editor-file-read-complete',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace),durationMs:Math.round((performance.now()-readStarted)*100)/100,size,outcome,mode:'full'})
        }
        this.savedLineEnding=this.lineEnding;this.savedTextEncoding=this.textEncoding
    }
    private setTextFormat(bytes:Uint8Array):void{
        this.textEncoding=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'UTF-8 BOM':'UTF-8'
        const sample=new TextDecoder().decode(bytes)
        const crlf=(sample.match(/\r\n/g)??[]).length,lf=(sample.match(/(?<!\r)\n/g)??[]).length
        this.lineEnding=crlf>lf?'CRLF':'LF'
    }
    get editorLineNumbers():string{
        const source=this.editorText.split('\n'),start=1
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
        const before=this.editorText.slice(0,editor.selectionStart),start=1
        this.caretLine=start+(before.match(/\n/g)?.length??0)
        this.caretColumn=before.length-(before.lastIndexOf('\n')+1)+1
        this.lineJumpInput=String(this.caretLine)
    }
    private formattedText(text:string):string{
        const normalized=text.replace(/\r\n?/g,'\n'),eol=this.lineEnding==='CRLF'?'\r\n':'\n'
        return (this.textEncoding==='UTF-8 BOM'?'\ufeff':'')+normalized.replace(/\n/g,eol)
    }
    private displayText(text:string):string{return text.replace(/^\ufeff/,'')}
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
    recoveredEdit?:{content:string;original:string;hash?:string}
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
        this.updateCaretPosition()
    }
    openLineJump():void{this.lineJumpVisible=true;setTimeout(()=>this.lineJumpInputElement?.nativeElement.focus(),0)}
    async jumpToLine():Promise<void>{
        const target=Math.max(1,Math.floor(Number(this.lineJumpInput)||1));this.lineJumpVisible=false
        if(this.loading||this.saving)return
        const lines=this.content.split('\n');let offset=0
        for(let i=0;i<Math.min(target-1,lines.length-1);i++)offset+=lines[i].length+1
        this.textEditor?.nativeElement.setSelectionRange(offset,offset);this.updateCaretPosition();this.textEditor?.nativeElement.focus()
    }
    constructor (private injector: Injector) {
        super(injector)
        this.platform = injector.get(PlatformService)
        this.app = injector.get(AppService)
        this.notifications = injector.get(NotificationsService)
    }
    get dirty (): boolean {
        return !this.readonly&&(this.content!==this.original||this.lineEnding!==this.savedLineEnding||this.textEncoding!==this.savedTextEncoding)
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
    get waitingForConnection (): boolean { return !this.recoveredEdit && !this.isDiff && this.initialContent===undefined && Boolean(this.workspace?.waitForConnection) }
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
            this.content='';this.original='';this.hash=undefined
            this.binaryBytes=undefined;this.diff=undefined
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
        const original=this.original
        try {
            const file=await this.workspace.read(this.filePath)
            if(this.loading||this.saving||(this.readonly&&!this.error)||this.dirty||this.saveIssue||this.original!==original)return
            this.content=file.content;this.original=file.content;this.hash=file.hash
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
                this.binaryBytes=undefined
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
        if(options?.includeState!==false&&this.dirty)state.recoveredEdit={content:this.content,original:this.original,hash:this.hash}
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
