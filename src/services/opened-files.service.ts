import type { AppService } from 'tabby-core'
import type { Workspace } from '../arw-tree/workspace'

export interface OpenedWorkspaceFile {workspace:Workspace;filePath:string;refresh:()=>Promise<void>}
const opened=new Set<OpenedWorkspaceFile>()

export function registerOpenedWorkspaceFile(entry:OpenedWorkspaceFile):()=>void {
    opened.add(entry)
    return ()=>{opened.delete(entry)}
}

export function sameWorkspace(left:Workspace,right:Workspace):boolean {
    while(left.sourceWorkspace)left=left.sourceWorkspace
    while(right.sourceWorkspace)right=right.sourceWorkspace
    return left.kind===right.kind&&left.root===right.root&&left.host===right.host
}

export async function refreshOpenedWorkspaceFiles(_app:AppService|undefined,workspace:Workspace):Promise<void> {
    await Promise.all([...opened].filter(entry=>sameWorkspace(workspace,entry.workspace)).map(async entry=>{
        try {
            if(_app&&entry.workspace.kind==='remote'){
                const {remoteWorkspaceSession}=await import('../adapters/remote-workspace')
                if(remoteWorkspaceSession(entry.workspace)?.open===false){
                const {fileWorkspaceToken,restoredFileWorkspace,resolveFileWorkspace}=await import('../arw-tree/file-recovery')
                const token=fileWorkspaceToken(entry.workspace)
                if(token){
                    const replacement=await resolveFileWorkspace(restoredFileWorkspace(token,_app),AbortSignal.timeout(10000))
                    Object.assign(entry.workspace,replacement)
                }
                }
            }
            await entry.refresh()
        }catch{}
    }))
}
