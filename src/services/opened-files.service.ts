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
    await Promise.all([...opened].filter(entry=>sameWorkspace(workspace,entry.workspace)).map(entry=>entry.refresh().catch(()=>undefined)))
}
