import type { AppService, BaseTabComponent } from 'tabby-core'
import { isFilePane } from '../shared/pane-kind'

const readers=new WeakMap<object,()=>unknown>()
const order=new WeakMap<object,number>()
const pending=new WeakMap<object,Promise<void>>()
let sequence=0
export function remoteFileLimit(value:unknown):number {
    return typeof value==='number'&&Number.isInteger(value)&&value>=1?value:10
}
export function registerRemoteFileLimit(app:object,read:()=>unknown):()=>void {
    readers.set(app,read)
    return ()=>{if(readers.get(app)===read)readers.delete(app)}
}
function remoteFiles(app:AppService):BaseTabComponent[] {
    const files=(app.tabs??[]).flatMap(tab=>'getAllTabs' in tab?(tab as any).getAllTabs():[tab]) as BaseTabComponent[]
    return [...new Set(files)].filter(tab=>isFilePane(tab)&&(tab as any).workspace?.kind==='remote'&&!(tab as any).destroyed)
}
export function rememberRemoteFiles(app:AppService):void {
    for(const file of remoteFiles(app))if(!order.has(file))order.set(file,++sequence)
}
export async function enforceRemoteFileLimit(app:AppService):Promise<void> {
    const task=(pending.get(app)??Promise.resolve()).catch(()=>{}).then(async()=>{
        rememberRemoteFiles(app)
        const files=remoteFiles(app).sort((a,b)=>order.get(a)!-order.get(b)!)
        const excess=files.length-remoteFileLimit(readers.get(app)?.())
        for(const file of files.slice(0,Math.max(0,excess))){
            // Use the same close confirmation and disposal path as the pane close button.
            if(!await file.canClose())break
            if(app.tabs.includes(file))await app.closeTab(file,false)
            else if(app.getParentTab(file)?.getAllTabs().includes(file))file.destroy()
        }
    })
    pending.set(app,task)
    try{await task}finally{if(pending.get(app)===task)pending.delete(app)}
}
