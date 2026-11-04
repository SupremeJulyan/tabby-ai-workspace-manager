import { cp } from 'node:fs/promises'
import { shellQuote } from '../shared/shell-quote'
import { workspacePath } from '../shared/workspace-path'
import type { Workspace } from './workspace'
import type { SSHSession } from '../adapters/ssh-compat'
import { transfer } from '../arw-cli/transfers'
import { sftpCopy } from '../adapters/sftp-copy'
import { RemotePathGuard } from '../security/remote-path'

export interface CopySource {workspace:Workspace; path:string; hostKey:string; remote?:SSHSession; paths?:string[]}
let clipboard:CopySource|undefined
export function copyWorkspaceItem(source:CopySource):void {clipboard=source}
export function copiedWorkspaceItem():CopySource|undefined {return clipboard}

export function canPasteWorkspaceItem(source:CopySource,target:Workspace,hostKey:string):boolean {
    return source.workspace.kind!==target.kind||source.hostKey===hostKey
}

async function copyDestination(source:CopySource,target:Workspace,directory:string):Promise<string> {
    const paths=workspacePath(target.kind),name=paths.basename(source.path)
    let isDirectory=false
    try {
        const parent=paths.dirname(source.path)
        const entries=await source.workspace.list(parent)
        isDirectory=entries.find(entry=>entry.name===name)?.directory??false
    } catch { /* Keep paste available for workspace adapters without parent listings. */ }
    const entries=typeof target.list==='function'?await target.list(directory):[]
    const names=new Set(entries.map(entry=>entry.name))
    if(!names.has(name))return paths.resolve(target.root,directory,name)
    const extension=isDirectory?'':paths.extname(name)
    const stem=extension?name.slice(0,-extension.length):name
    let candidate=`${stem} copy${extension}`,index=2
    while(names.has(candidate))candidate=`${stem} copy ${index++}${extension}`
    return paths.resolve(target.root,directory,candidate)
}

/** Copy locally or on the shared remote host; use SFTP between local and remote. */
export async function pasteWorkspaceItem(source:CopySource,target:Workspace,directory:string,hostKey:string,targetRemote?:SSHSession):Promise<void> {
    if(!canPasteWorkspaceItem(source,target,hostKey))throw new Error('Copy requires source and destination on the same host and account')
    const paths=workspacePath(target.kind), destination=await copyDestination(source,target,directory)
    if(source.workspace.kind!==target.kind){
        const uploading=target.kind==='remote', remote=uploading?targetRemote:source.remote
        const remoteWorkspace=uploading?target:source.workspace
        if(!remote?.open)throw new Error('Source or destination SSH session is disconnected')
        const controller=new AbortController(),closed=remote.willDestroy$.subscribe(()=>controller.abort())
        remote.ref()
        try{
            const guard=new RemotePathGuard(remoteWorkspace.root,(command,signal)=>remoteWorkspace.run(command,signal))
            const copy=sftpCopy(()=>remote.openSFTP(),guard)
            const invoke=async(name:string,args:Record<string,unknown>):Promise<Record<string,unknown>>=>{
                if(name==='remote_list'){
                    const entries=await remoteWorkspace.list(String(args.path),controller.signal)
                    const offset=Number(args.cursor??0),limit=Number(args.limit??1000),end=offset+limit
                    return {entries:entries.slice(offset,end),truncated:end<entries.length,...(end<entries.length?{nextCursor:String(end)}:{})}
                }
                return await copy(args,args.action==='cancel'?new AbortController().signal:controller.signal) as Record<string,unknown>
            }
            await transfer(uploading?'upload':'download',{source:source.path,target:destination,recursive:true},invoke)
        }finally{closed.unsubscribe();controller.abort();remote.unref()}
        return
    }
    if(target.kind==='local'){
        await cp(source.path,destination,{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true})
        return
    }
    const from=shellQuote(source.path),to=shellQuote(destination)
    const result=await target.run(`if test -e ${to} || test -L ${to}; then echo 'Copy target already exists' >&2; exit 1; fi; cp -a -n -T -- ${from} ${to}`)
    if(result.exitCode!==0)throw new Error(result.stderr||'Copy failed')
}
