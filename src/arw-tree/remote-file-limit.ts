import type { AppService, BaseTabComponent } from 'tabby-core'
import { isFilePane } from '../shared/pane-kind'
import { logOperation } from '../services/operation-log'

const readers=new WeakMap<object,()=>unknown>()
const order=new WeakMap<object,number>()
const pending=new WeakMap<object,Promise<void>>()
let sequence=0
export function remoteFileLimit(value:unknown):number {
    return typeof value==='number'&&Number.isInteger(value)&&value>=1?Math.min(value,9):9
}
export function registerRemoteFileLimit(app:object,read:()=>unknown):()=>void {
    readers.set(app,read)
    const service=app as AppService
    let timer:ReturnType<typeof setTimeout>|undefined
    const schedule=()=>{
        if(timer!==undefined)return
        timer=setTimeout(()=>{
            timer=undefined
            void enforceRemoteFileLimit(service,0,true).catch(error=>logOperation('检查文件页数量上限',{error:String(error)}))
        },0)
    }
    const subscription=service.tabsChanged$?.subscribe(schedule)
    if(subscription)schedule()
    return ()=>{
        clearTimeout(timer);subscription?.unsubscribe()
        if(readers.get(app)===read)readers.delete(app)
    }
}
function remoteFiles(app:AppService):BaseTabComponent[] {
    const files=(app.tabs??[]).flatMap(tab=>'getAllTabs' in tab?(tab as any).getAllTabs():[tab]) as BaseTabComponent[]
    return [...new Set(files)].filter(isFilePane)
}
export function rememberRemoteFiles(app:AppService):void {
    for(const file of remoteFiles(app))if(!order.has(file))order.set(file,++sequence)
}
export async function enforceRemoteFileLimit(app:AppService,reserve=0,silent=false):Promise<boolean> {
    const limit=()=>remoteFileLimit(readers.get(app)?.())
    const task=(pending.get(app)??Promise.resolve()).catch(()=>{}).then(async()=>{
        rememberRemoteFiles(app)
        const files=remoteFiles(app).sort((a,b)=>order.get(a)!-order.get(b)!)
        for(const file of files){
            if(remoteFiles(app).length+reserve<=limit())break
            const state=file as BaseTabComponent&{effectivelyPinned?:boolean;dirty?:boolean;saving?:boolean;saveIssue?:unknown;loading?:boolean}
            if(state.effectivelyPinned||state.loading||state.saving||state.saveIssue||(silent&&state.dirty))continue
            // Use the same close confirmation and disposal path as the pane close button.
            if(!await file.canClose()){if(silent)continue;break}
            if(app.tabs.includes(file))await app.closeTab(file,false)
            else if(app.getParentTab(file)?.getAllTabs().includes(file))file.destroy()
        }
    })
    pending.set(app,task)
    try{await task}finally{if(pending.get(app)===task)pending.delete(app)}
    return remoteFiles(app).length+reserve<=limit()
}
