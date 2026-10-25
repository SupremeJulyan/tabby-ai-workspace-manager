import { t } from '../shared/i18n'
import { openAdjacentTab } from '../shared/open-adjacent-tab'
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, Injector, ViewChild } from '@angular/core'
import { AppService, BaseTabComponent, PlatformService, type RecoveryToken } from 'tabby-core'
import { join } from 'node:path'
import type { Workspace } from './workspace'
import { remoteWorkspaceSession } from '../adapters/remote-workspace'
import { ArwEditorComponent } from './editor.component'
import { previewKind, previewMaxBytes, imageMime, markdownImages, relativePreviewAsset, renderMarkdown, decodePreviewText, parseCsv, detectDelimiter, type CsvPreview } from './preview/model'
import type { PdfDocument, PdfLoading } from './preview/pdf-engine'
import { PREVIEW_TEMPLATE, PREVIEW_STYLES } from './preview.view'
import * as UTIF from 'utif'
import { registerOpenedWorkspaceFile } from '../services/opened-files.service'
import { fileWorkspaceToken, resolveFileWorkspace } from './file-recovery'
import { TextSearch } from './text-search'

@Component({selector:'arw-preview',template:PREVIEW_TEMPLATE,styles:[PREVIEW_STYLES]})
export class ArwPreviewComponent extends BaseTabComponent implements AfterViewInit {
    workspace!:Workspace
    filePath=''
    imagePaths:string[]=[]
    loading=true
    error=''
    byteLength=0
    encoding=''
    text=''
    source=false
    markdown=''
    imageUrl=''
    imageWidth=0
    imageHeight=0
    zoom=1
    fit=true
    csv:CsvPreview={rows:[],columns:0,truncated:false}
    csvDelimiter='auto'
    csvActualDelimiter=','
    csvHeader=true
    csvQuery=''
    csvPage=1
    csvFiltered:Array<{values:string[];index:number}>=[]
    pdfDocument?:PdfDocument
    pdfLoading?:PdfLoading
    pdfPage=1
    pdfPageInput=1
    pdfRendering=false
    pdfPassword=''
    pdfPasswordRequired=false
    pdfPasswordError=''
    private passwordCallback?:((password:string)=>void)
    private renderTask?:{promise:Promise<void>;cancel():void}
    private controller=new AbortController()
    private version=0
    private viewReady=false
    private closed=false
    private releaseRemote?:()=>void
    private unregisterFile?:()=>void
    private platform:PlatformService
    private app:AppService
    private detector:ChangeDetectorRef
    @ViewChild('pdfCanvasHost') pdfCanvasHost?:ElementRef<HTMLElement>
    @ViewChild('textPreview') textPreview?:ElementRef<HTMLTextAreaElement>
    @ViewChild('findInput') findInput?:ElementRef<HTMLInputElement>
    readonly search=new TextSearch(()=>this.text,()=>{},()=>this.textPreview?.nativeElement,
        ()=>this.findInput?.nativeElement,()=>false,()=>{this.source=true},()=>this.edit(true))
    @HostListener('keydown',['$event']) searchKey(event:KeyboardEvent):void {if(this.isText&&!this.loading&&!this.error)this.search.key(event)}
    constructor(injector:Injector){super(injector);this.platform=injector.get(PlatformService);this.app=injector.get(AppService);this.detector=injector.get(ChangeDetectorRef)}
    get kind(){return previewKind(this.filePath)}
    get isText(){return this.kind==='markdown'||this.kind==='csv'}
    get canEdit(){return this.isText&&this.encoding==='UTF-8'&&this.byteLength<=10*1024*1024&&!this.loading&&!this.error}
    get waitingForConnection(){return Boolean(this.workspace?.waitForConnection)}
    get connectionStatus(){return this.workspace?.connectionStatus}
    get imageIndex(){return this.imagePaths.indexOf(this.filePath)}
    get csvHeaders(){return Array.from({length:this.csv.columns},(_,index)=>this.csvHeader?(this.csv.rows[0]?.[index]||t`列 ${index+1}`):t`列 ${index+1}`)}
    get csvPages(){return Math.max(1,Math.ceil(this.csvFiltered.length/100))}
    get csvPageRows(){return this.csvFiltered.slice((this.csvPage-1)*100,this.csvPage*100)}
    private render(){if(this.viewReady&&!this.closed)this.detector.detectChanges()}
    async ngOnInit():Promise<void>{
        this.setTitle(t`预览 · ${this.filePath}`)
        try{this.workspace=await resolveFileWorkspace(this.workspace,this.controller.signal)}
        catch(error){if(!this.closed){this.error=String(error);this.loading=false;this.render()}return}
        const remote=remoteWorkspaceSession(this.workspace)
        if(remote?.open){remote.ref();const closed=remote.willDestroy$.subscribe(()=>this.controller.abort());this.releaseRemote=()=>{closed.unsubscribe();remote.unref()}}
        if(!this.imagePaths.includes(this.filePath))this.imagePaths=[this.filePath]
        await this.load()
        if(this.isText&&!this.closed)this.unregisterFile=registerOpenedWorkspaceFile({workspace:this.workspace,filePath:this.filePath,refresh:async()=>{if(!this.loading&&!this.closed)await this.load()}})
    }
    ngAfterViewInit():void{this.viewReady=true;if(this.pdfDocument)void this.renderPdf()}
    async getRecoveryToken():Promise<RecoveryToken|null>{
        const workspace=this.workspace&&fileWorkspaceToken(this.workspace)
        return workspace?{type:'arw-preview',workspace,filePath:this.filePath,state:{imagePaths:this.imagePaths}}:null
    }
    private async bytes(path:string,maxBytes:number):Promise<Uint8Array>{
        if(this.workspace.readBytes){
            try{return await this.workspace.readBytes(path,maxBytes,this.controller.signal)}
            catch(error){if(!this.isText||!String(error).includes(t('不支持 SFTP 二进制预览')))throw error}
        }
        const bytes=Buffer.from((await this.workspace.read(path)).content)
        if(bytes.length>maxBytes)throw new Error(t('文件超过预览大小限制'))
        return bytes
    }
    private async imageBlob(bytes:Uint8Array,path:string):Promise<Blob>{
        const mime=imageMime(path)
        if(mime!=='image/tiff')return new Blob([new Uint8Array(bytes).buffer],{type:mime})
        const buffer=new Uint8Array(bytes).buffer,frame=UTIF.decode(buffer)[0]
        if(!frame)throw new Error(t('TIFF 文件没有图像'))
        const width=Number((frame.t256 as number[]|undefined)?.[0]??frame.width),height=Number((frame.t257 as number[]|undefined)?.[0]??frame.height)
        if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16*1024*1024)throw new Error(t('TIFF 图像尺寸超过预览限制'))
        UTIF.decodeImage(buffer,frame)
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
        const context=canvas.getContext('2d');if(!context)throw new Error(t('无法创建图片预览'))
        const pixels=context.createImageData(width,height);pixels.data.set(UTIF.toRGBA8(frame));context.putImageData(pixels,0,0)
        return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(t('TIFF 解码失败'))),'image/png'))
    }
    private async load():Promise<void>{
        const version=++this.version,path=this.filePath,kind=this.kind
        this.loading=true;this.error='';this.text='';this.source=false;this.markdown='';this.fit=true;this.zoom=1
        this.setTitle(t`预览 · ${path}`);this.render()
        try{
            if(!kind)throw new Error(t('不支持此文件的预览格式'))
            const bytes=await this.bytes(path,previewMaxBytes(kind));if(version!==this.version||this.closed)return
            this.byteLength=bytes.length
            if(kind==='image'){
                const blob=await this.imageBlob(bytes,path);if(version!==this.version||this.closed)return
                if(this.imageUrl)URL.revokeObjectURL(this.imageUrl)
                this.imageUrl=URL.createObjectURL(blob);this.imageWidth=0;this.imageHeight=0
            }else if(kind==='pdf'){
                if(!Buffer.from(bytes.subarray(0,1024)).includes(Buffer.from('%PDF-')))throw new Error(t('文件不是有效的 PDF'))
                const engine=require(join(__dirname,'pdf-preview.cjs')) as typeof import('./preview/pdf-engine')
                const task=engine.openPdf(bytes);this.pdfLoading=task
                task.onPassword=(callback,reason)=>{this.passwordCallback=callback;this.pdfPasswordRequired=true;this.pdfPasswordError=reason===2?t('密码不正确，请重试'):'';this.loading=false;this.render()}
                const pdf=await task.promise
                if(version!==this.version||this.closed){await pdf.destroy();return}
                this.pdfDocument=pdf;this.pdfPage=1;this.pdfPageInput=1;this.pdfPasswordRequired=false;this.loading=false;this.render()
                if(this.viewReady)await this.renderPdf()
            }else{
                const decoded=decodePreviewText(bytes);this.text=decoded.text;this.encoding=decoded.encoding
                if(kind==='csv')this.parseTable()
                else {
                    const assets=new Map<string,string>();let total=0
                    for(const href of markdownImages(this.text)){
                        const asset=relativePreviewAsset(path,href,this.workspace.kind)
                        if(!asset||!imageMime(asset)||imageMime(asset)==='image/tiff')continue
                        try{
                            const bytes=await this.bytes(asset,4*1024*1024);total+=bytes.length
                            if(total>16*1024*1024)break
                            assets.set(href,`data:${imageMime(asset)};base64,${Buffer.from(bytes).toString('base64')}`)
                        }catch{/* A missing image must not hide the document. */}
                        if(version!==this.version||this.closed)return
                    }
                    this.markdown=renderMarkdown(this.text,assets)
                }
            }
        }catch(error){if(version===this.version&&!this.closed)this.error=this.controller.signal.aborted?t('预览读取已取消或 SSH 已断开'):error instanceof Error?error.message:String(error)}
        finally{if(version===this.version&&!this.closed){this.loading=false;this.render()}}
    }
    async reload():Promise<void>{if(this.loading||this.pdfRendering)return;++this.version;this.loading=true;if(this.pdfLoading)await this.pdfLoading.destroy().catch(()=>undefined);this.pdfLoading=undefined;this.pdfDocument=undefined;this.pdfPasswordRequired=false;await this.load()}
    async changeImage(delta:number):Promise<void>{
        const path=this.imagePaths[this.imageIndex+delta];if(this.loading||!path)return
        this.filePath=path;await this.load()
    }
    imageLoaded(event:Event):void{
        const image=event.target as HTMLImageElement;this.imageWidth=image.naturalWidth;this.imageHeight=image.naturalHeight
        if(this.imageWidth*this.imageHeight>64*1024*1024)this.error=t('图像尺寸超过预览限制')
        this.render()
    }
    imageFailed():void{this.error=t('图片无法解码，格式可能不受支持或文件已损坏');this.render()}
    async changeZoom(delta:number):Promise<void>{this.fit=false;this.zoom=Math.max(.1,Math.min(4,Math.round((this.zoom+delta)*10)/10));if(this.kind==='pdf')await this.renderPdf()}
    async fitContent():Promise<void>{this.fit=true;this.zoom=1;if(this.kind==='pdf')await this.renderPdf()}
    parseTable():void{
        try{this.csvActualDelimiter=this.csvDelimiter==='auto'?(this.filePath.toLowerCase().endsWith('.tsv')?'\t':detectDelimiter(this.text)):this.csvDelimiter;this.csv=parseCsv(this.text,this.csvActualDelimiter);this.error='';this.filterTable()}
        catch(error){this.error=String(error)}
    }
    filterTable():void{
        const query=this.csvQuery.toLocaleLowerCase(),start=this.csvHeader?1:0
        this.csvFiltered=this.csv.rows.map((values,index)=>({values,index:index+1})).slice(start).filter(row=>!query||row.values.some(value=>value.toLocaleLowerCase().includes(query)))
        this.csvPage=1
    }
    changeCsvPage(delta:number):void{this.csvPage=Math.max(1,Math.min(this.csvPages,this.csvPage+delta))}
    edit(replace=false):void{if(this.canEdit)openAdjacentTab(this.app,{type:ArwEditorComponent,inputs:{workspace:this.workspace,filePath:this.filePath,...(replace?{initialFind:{...this.search.state,replaceVisible:true}}:{})}})}
    markdownClick(event:MouseEvent):void{
        const anchor=(event.target as Element)?.closest?.('a');if(!anchor)return
        event.preventDefault();const href=anchor.getAttribute('href')??''
        if(/^(?:https?:|mailto:)/i.test(href))void this.platform.openExternal(href)
        else if(href.startsWith('#')){
            const root=event.currentTarget as HTMLElement
            let id=href.slice(1);try{id=decodeURIComponent(id)}catch{return}
            for(const heading of Array.from(root.querySelectorAll('[id]')))if(heading.id===id){heading.scrollIntoView();break}
        }
    }
    unlockPdf():void{if(!this.pdfPassword||!this.passwordCallback)return;this.loading=true;this.pdfPasswordRequired=false;this.passwordCallback(this.pdfPassword);this.pdfPassword=''}
    async changePdfPage(delta:number):Promise<void>{this.pdfPageInput=this.pdfPage+delta;await this.goPdfPage()}
    async goPdfPage():Promise<void>{if(!this.pdfDocument||this.pdfRendering)return;this.pdfPage=Math.max(1,Math.min(this.pdfDocument.numPages,Math.trunc(Number(this.pdfPageInput)||1)));this.pdfPageInput=this.pdfPage;await this.renderPdf()}
    async renderPdf():Promise<void>{
        const pdf=this.pdfDocument,host=this.pdfCanvasHost?.nativeElement,version=this.version
        if(!pdf||!host||this.pdfRendering||this.closed)return
        this.pdfRendering=true;this.render()
        let page:Awaited<ReturnType<PdfDocument['getPage']>>|undefined
        try{
            page=await pdf.getPage(this.pdfPage);if(this.closed||version!==this.version)return
            const ratio=Math.min(window.devicePixelRatio||1,2),base=page.getViewport({scale:1}),desired=this.fit?Math.max(200,host.clientWidth-32)/base.width:this.zoom
            const scale=Math.min(desired,4096/ratio/base.width,8192/ratio/base.height,Math.sqrt(16*1024*1024/ratio/ratio/base.width/base.height))
            const viewport=page.getViewport({scale}),canvas=document.createElement('canvas')
            canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`
            host.replaceChildren(canvas)
            this.renderTask=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]})
            await this.renderTask.promise
        }catch(error){if(!this.closed&&version===this.version)this.error=error instanceof Error?error.message:String(error)}
        finally{page?.cleanup();this.renderTask=undefined;this.pdfRendering=false;this.render()}
    }
    ngOnDestroy():void{
        this.search.destroy()
        this.closed=true;this.version++;this.controller.abort();this.renderTask?.cancel();this.unregisterFile?.()
        void this.pdfLoading?.destroy().catch(()=>undefined)
        if(this.imageUrl)URL.revokeObjectURL(this.imageUrl)
        this.releaseRemote?.();super.ngOnDestroy()
    }
}
