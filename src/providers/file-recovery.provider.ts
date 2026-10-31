import { Injectable, Injector } from '@angular/core'
import { AppService, TabRecoveryProvider, type BaseTabComponent, type RecoveryToken } from 'tabby-core'
import { ArwEditorComponent } from '../arw-tree/editor.component'
import { ArwPreviewComponent } from '../arw-tree/preview.component'
import { restoredFileWorkspace, type FileWorkspaceToken } from '../arw-tree/file-recovery'
import { FileSessionPool } from '../services/file-session-pool'
import { logFileRecovery } from '../services/file-recovery-log'
import { paneLayout } from '../shared/pane-layout'

@Injectable()
export class FileRecoveryProvider extends TabRecoveryProvider<BaseTabComponent> {
    private pool?:FileSessionPool
    constructor(private injector:Injector){
        super()
        logFileRecovery('provider-created',{diagnosticsVersion:2,injectorPresent:!!injector})
    }
    ngOnDestroy():void{this.pool?.dispose()}
    async applicableTo(token:RecoveryToken):Promise<boolean> {
        return token.type==='arw-editor'||token.type==='arw-preview'
    }
    async recover(token:RecoveryToken) {
        const app=this.injector.get(AppService)
        logFileRecovery('app-resolved',{appType:app?.constructor?.name,tabsPresent:Array.isArray(app?.tabs),tabCount:app?.tabs?.length})
        if(!Array.isArray(app?.tabs))throw new Error('ARW file recovery could not resolve the initialized AppService')
        this.pool??=new FileSessionPool(app,this.injector)
        const workspace=token.workspace as FileWorkspaceToken
        logFileRecovery('recover-token',{type:token.type,filePath:token.filePath,workspace:workspace&&{
            kind:workspace.kind,root:workspace.root,host:workspace.host,port:workspace.port,user:workspace.user,profileId:workspace.profileId}})
        if(!workspace||!['local','remote'].includes(workspace.kind)||typeof workspace.root!=='string'||typeof workspace.host!=='string'||typeof token.filePath!=='string'){
            throw new Error('Invalid ARW file recovery token')
        }
        const state=token.state??{}
        const inputs:Record<string,unknown>={workspace:restoredFileWorkspace(workspace,app,this.pool),filePath:token.filePath}
        for(const key of ['initialContent','diffPatch','diffLabel','diffDescription']){
            if(typeof state[key]==='string')inputs[key]=state[key]
        }
        for(const key of ['readonly','diffStaged'])if(typeof state[key]==='boolean')inputs[key]=state[key]
        if(typeof state.diffPatch!=='string'&&typeof state.initialContent!=='string')inputs.readonly=false
        if(['split','unified'].includes(state.diffMode))inputs.diffMode=state.diffMode
        if(Array.isArray(state.imagePaths)&&state.imagePaths.every((path:unknown)=>typeof path==='string'))inputs.imagePaths=state.imagePaths
        if(state.arwPaneLayout!==undefined)inputs.arwPaneLayout=paneLayout(state.arwPaneLayout)
        if(typeof state.recoveredEdit?.content==='string'&&typeof state.recoveredEdit?.original==='string'&&typeof state.recoveredEdit?.hash==='string'){
            inputs.recoveredEdit={content:state.recoveredEdit.content,original:state.recoveredEdit.original,hash:state.recoveredEdit.hash}
        }
        return {type:token.type==='arw-preview'?ArwPreviewComponent:ArwEditorComponent,inputs}
    }
}
