import type { PaneLayout } from '../shared/pane-layout'
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
import { isFileConflict } from '../shared/file-conflict'
import { previewKind, renderMarkdown, markdownImages, relativePreviewAsset, imageMime } from './preview/model'

@Component({
    selector: 'arw-editor',
    template: EDITOR_TEMPLATE,
    styles: [EDITOR_STYLES],
})
export class ArwEditorComponent extends BaseTabComponent implements AfterViewInit {
    readonly arwFilePane=true
    get arwWorkspaceIdentity(){return this.workspace&&fileWorkspaceToken(this.workspace)}
    arwPaneLayout:PaneLayout='tiled'
    workspace!: Workspace
    filePath = ''
    content = ''
    original = ''
    hash?: string
    readonly = false
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
    recoveredEdit?:{content:string;original:string;hash?:string}
    initialFind?:FindState
    @ViewChild('textEditor') textEditor?:ElementRef<HTMLTextAreaElement>
    @ViewChild('findInput') findInput?:ElementRef<HTMLInputElement>
    readonly search=new TextSearch(()=>this.content,text=>{this.content=text},()=>this.textEditor?.nativeElement,
        ()=>this.findInput?.nativeElement,()=>!this.readonly&&!this.loading&&!this.saving&&!this.isDiff&&!this.saveIssue,
        ()=>{this.markdownPreview=false;this.markdownVersion++})
    @HostListener('keydown',['$event']) searchKey(event:KeyboardEvent):void {if(!this.isDiff)this.search.key(event)}
    constructor (injector: Injector) {
        super(injector)
        this.platform = injector.get(PlatformService)
        this.app = injector.get(AppService)
        this.notifications = injector.get(NotificationsService)
    }
    get dirty (): boolean { return !this.readonly && this.content !== this.original }
    get saveIssue (): {message:string;busy:boolean}|undefined {return this.workspace?.saveIssue?.(this.filePath)}
    get isDiff (): boolean { return this.diffPatch !== undefined }
    get isMarkdown():boolean {return !this.isDiff&&previewKind(this.filePath)==='markdown'}
    async toggleMarkdown():Promise<void> {
        if(!this.isMarkdown||this.loading||this.saving)return
        const version=++this.markdownVersion
        this.markdownPreview=!this.markdownPreview;this.markdownError=''
        if(!this.markdownPreview)return
        this.search.close()
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
    get visibleHunks (): DiffHunk[] { return this.activeHunk < 0 ? this.diff?.hunks ?? [] : this.diff?.hunks.slice(this.activeHunk,this.activeHunk+1) ?? [] }
    nextHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk+1)%this.diff.hunks.length }
    previousHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk<0?this.diff.hunks.length-1:(this.activeHunk-1+this.diff.hunks.length)%this.diff.hunks.length) }
    ngDoCheck (): void {
        const title=`${this.dirty||this.saveIssue?'● ':''}${this.isDiff?'Diff':this.readonly?'Read-only':this.waitingForConnection?'Waiting':'Edit'} · ${this.filePath}`
        if(this.title!==title)this.setTitle(title)
    }
    async ngOnInit (): Promise<void> {
        this.setTitle(`${this.isDiff?'Diff':this.readonly?'Read-only':'Edit'} · ${this.filePath}`)
        try {
            if (this.isDiff) { this.readonly=true; this.diff=parseDiff(this.diffPatch!); return }
            this.workspace=await resolveFileWorkspace(this.workspace,this.recoveryController.signal)
            if(this.recoveredEdit){Object.assign(this,this.recoveredEdit);return}
            else if (this.initialContent !== undefined) { this.content = this.initialContent; this.readonly = true }
            else {
                logFileRecovery('editor-read-start',{filePath:this.filePath,workspace:fileWorkspaceToken(this.workspace)})
                const file = await this.workspace.read(this.filePath); this.content = file.content; this.hash = file.hash
                logFileRecovery('editor-read-ready',{filePath:this.filePath})
            }
            this.original = this.content
        } catch (error) {
            logFileRecovery('editor-load-error',{filePath:this.filePath,cancelled:this.recoveryController.signal.aborted,error:String(error)})
            this.error = String(error); this.readonly = true
        }
        finally {
            this.loading = false
            if(this.initialFind)this.search.restore(this.initialFind)
            if(!this.recoveryController.signal.aborted&&!this.isDiff&&this.initialContent===undefined&&!this.waitingForConnection)this.unregisterFile=registerOpenedWorkspaceFile({workspace:this.workspace,filePath:this.filePath,refresh:()=>this.reloadOpenFile()})
        }
    }
    async reloadOpenFile (): Promise<void> {
        if(this.loading||this.saving||this.readonly||this.dirty||this.saveIssue)return
        const original=this.original
        try {
            const file=await this.workspace.read(this.filePath)
            if(this.saving||this.readonly||this.dirty||this.saveIssue||this.original!==original)return
            this.content=file.content;this.original=file.content;this.hash=file.hash
            if(this.markdownPreview){this.markdownPreview=false;await this.toggleMarkdown()}
        } catch(error) {this.error=String(error)}
    }
    async getRecoveryToken(options?:GetRecoveryTokenOptions):Promise<RecoveryToken|null> {
        const workspace=this.workspace&&fileWorkspaceToken(this.workspace)
        if(!workspace)return null
        const state:Record<string,unknown>={arwPaneLayout:this.arwPaneLayout,readonly:this.readonly,initialContent:this.initialContent,diffPatch:this.diffPatch,
            diffLabel:this.diffLabel,diffDescription:this.diffDescription,diffStaged:this.diffStaged,diffMode:this.diffMode}
        if(options?.includeState!==false&&this.dirty)state.recoveredEdit={content:this.content,original:this.original,hash:this.hash}
        if(this.saveIssue){state.initialContent=this.content;delete state.recoveredEdit}
        return {type:'arw-editor',workspace,filePath:this.filePath,state}
    }
    ngAfterViewInit (): void { this.removePaneHeader=addFileCloseButton(this,this.app,error=>this.notifications.error(t('关闭文件失败'),String(error))) }
    ngOnDestroy (): void { this.removePaneHeader?.();this.search.destroy();this.recoveryController.abort();this.unregisterFile?.(); super.ngOnDestroy() }
    saveKey (event: Event): void { event.preventDefault(); void this.save() }
    async save (): Promise<void> {
        if (this.readonly || this.saving || this.loading || !this.dirty || this.saveIssue) return
        this.saving = true; this.error = ''
        const content = this.content
        try {
            let file
            try { file=await this.workspace.write(this.filePath,content,this.hash) }
            catch(error){
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
        catch (error) { this.error = String(error) }
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
