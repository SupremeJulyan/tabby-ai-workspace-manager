import { Injectable, Injector } from '@angular/core'
import { AppService, TabRecoveryProvider, type BaseTabComponent, type RecoveryToken } from 'tabby-core'
import { ArwEditorComponent } from '../arw-tree/editor.component'
import { ArwPreviewComponent } from '../arw-tree/preview.component'
import { restoredFileWorkspace, type FileWorkspaceToken } from '../arw-tree/file-recovery'
import { FileSessionPool } from '../services/file-session-pool'

@Injectable()
export class FileRecoveryProvider extends TabRecoveryProvider<BaseTabComponent> {
    private pool?:FileSessionPool
    constructor(private app:AppService,injector?:Injector){super();if(injector)this.pool=new FileSessionPool(app,injector)}
    ngOnDestroy():void{this.pool?.dispose()}
    async applicableTo(token:RecoveryToken):Promise<boolean> {
        return token.type==='arw-editor'||token.type==='arw-preview'
    }
    async recover(token:RecoveryToken) {
        const workspace=token.workspace as FileWorkspaceToken
        if(!workspace||!['local','remote'].includes(workspace.kind)||typeof workspace.root!=='string'||typeof workspace.host!=='string'||typeof token.filePath!=='string'){
            throw new Error('Invalid ARW file recovery token')
        }
        const state=token.state??{}
        const inputs:Record<string,unknown>={workspace:restoredFileWorkspace(workspace,this.app,this.pool),filePath:token.filePath}
        for(const key of ['initialContent','diffPatch','diffLabel','diffDescription']){
            if(typeof state[key]==='string')inputs[key]=state[key]
        }
        for(const key of ['readonly','diffStaged'])if(typeof state[key]==='boolean')inputs[key]=state[key]
        if(typeof state.diffPatch!=='string'&&typeof state.initialContent!=='string')inputs.readonly=false
        if(['split','unified'].includes(state.diffMode))inputs.diffMode=state.diffMode
        if(Array.isArray(state.imagePaths)&&state.imagePaths.every((path:unknown)=>typeof path==='string'))inputs.imagePaths=state.imagePaths
        if(typeof state.recoveredEdit?.content==='string'&&typeof state.recoveredEdit?.original==='string'&&typeof state.recoveredEdit?.hash==='string'){
            inputs.recoveredEdit={content:state.recoveredEdit.content,original:state.recoveredEdit.original,hash:state.recoveredEdit.hash}
        }
        return {type:token.type==='arw-preview'?ArwPreviewComponent:ArwEditorComponent,inputs}
    }
}
