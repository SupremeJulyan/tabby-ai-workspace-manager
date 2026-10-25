import { t } from '../shared/i18n'
import { Component, Injector } from '@angular/core'
import { BaseTabComponent, PlatformService } from 'tabby-core'
import { Workspace } from './workspace'
import { parseDiff, DiffModel, DiffHunk } from './git/diff-model'
import { EDITOR_TEMPLATE, EDITOR_STYLES } from './editor.view'
import { registerOpenedWorkspaceFile } from '../services/opened-files.service'

@Component({
    selector: 'arw-editor',
    template: EDITOR_TEMPLATE,
    styles: [EDITOR_STYLES],
})
export class ArwEditorComponent extends BaseTabComponent {
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
    private platform: PlatformService
    private unregisterFile?:()=>void
    constructor (injector: Injector) { super(injector); this.platform = injector.get(PlatformService) }
    get dirty (): boolean { return !this.readonly && this.content !== this.original }
    get saveIssue (): {message:string;busy:boolean}|undefined {return this.workspace?.saveIssue?.(this.filePath)}
    get isDiff (): boolean { return this.diffPatch !== undefined }
    get visibleHunks (): DiffHunk[] { return this.activeHunk < 0 ? this.diff?.hunks ?? [] : this.diff?.hunks.slice(this.activeHunk,this.activeHunk+1) ?? [] }
    nextHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk+1)%this.diff.hunks.length }
    previousHunk (): void { if(this.diff?.hunks.length)this.activeHunk=(this.activeHunk<0?this.diff.hunks.length-1:(this.activeHunk-1+this.diff.hunks.length)%this.diff.hunks.length) }
    ngDoCheck (): void {
        const title=`${this.dirty||this.saveIssue?'● ':''}${this.isDiff||this.readonly?'Diff':'Edit'} · ${this.filePath}`
        if(this.title!==title)this.setTitle(title)
    }
    async ngOnInit (): Promise<void> {
        this.setTitle(`${this.isDiff || this.readonly ? 'Diff' : 'Edit'} · ${this.filePath}`)
        try {
            if (this.isDiff) { this.readonly=true; this.diff=parseDiff(this.diffPatch!); return }
            else if (this.initialContent !== undefined) { this.content = this.initialContent; this.readonly = true }
            else { const file = await this.workspace.read(this.filePath); this.content = file.content; this.hash = file.hash }
            this.original = this.content
        } catch (error) { this.error = String(error); this.readonly = true }
        finally {
            this.loading = false
            if(!this.isDiff&&this.initialContent===undefined)this.unregisterFile=registerOpenedWorkspaceFile({workspace:this.workspace,filePath:this.filePath,refresh:()=>this.reloadOpenFile()})
        }
    }
    async reloadOpenFile (): Promise<void> {
        if(this.loading||this.saving||this.readonly||this.dirty||this.saveIssue)return
        const original=this.original
        try {
            const file=await this.workspace.read(this.filePath)
            if(this.saving||this.readonly||this.dirty||this.saveIssue||this.original!==original)return
            this.content=file.content;this.original=file.content;this.hash=file.hash
        } catch(error) {this.error=String(error)}
    }
    ngOnDestroy (): void { this.unregisterFile?.(); super.ngOnDestroy() }
    saveKey (event: Event): void { event.preventDefault(); void this.save() }
    async save (): Promise<void> {
        if (this.readonly || this.saving || this.loading || !this.dirty || this.saveIssue) return
        this.saving = true; this.error = ''
        const content = this.content
        try { const file = await this.workspace.write(this.filePath, content, this.hash); this.hash = file.hash; this.original = content }
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
