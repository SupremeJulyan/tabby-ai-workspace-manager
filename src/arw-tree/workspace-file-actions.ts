import { lstat, realpath, rename, rm } from 'node:fs/promises'
import { workspacePath } from '../shared/workspace-path'
import { shellQuote } from '../shared/shell-quote'
import { RemotePathGuard } from '../security/remote-path'
import type { Workspace } from './workspace'

export function fileActionPath(workspace:Workspace,input:string):string {
    const paths=workspacePath(workspace.kind),root=paths.resolve(workspace.root),target=paths.resolve(root,input),rel=paths.relative(root,target)
    if(!rel||rel==='..'||rel.startsWith(`..${paths.sep}`)||paths.isAbsolute(rel))throw new Error('Choose an item inside the workspace')
    return target
}

/** Selecting a directory and one of its children operates on the directory once. */
export function topLevelItems(workspace:Workspace,inputs:string[]):string[] {
    const paths=workspacePath(workspace.kind),items=[...new Set(inputs.map(input=>fileActionPath(workspace,input)))]
    return items.filter(item=>!items.some(parent=>parent!==item&&item.startsWith(parent+paths.sep)))
}

async function checkedLocalPath(workspace:Workspace,input:string):Promise<string> {
    const target=fileActionPath(workspace,input),paths=workspacePath('local')
    const root=await realpath(workspace.root),parent=await realpath(paths.dirname(target)),rel=paths.relative(root,parent)
    if(rel==='..'||rel.startsWith(`..${paths.sep}`)||paths.isAbsolute(rel))throw new Error('Path leaves the workspace through a symbolic link')
    return target
}

export async function moveWorkspaceItem(workspace:Workspace,input:string,destination:string):Promise<void> {
    const source=fileActionPath(workspace,input),target=fileActionPath(workspace,destination)
    const paths=workspacePath(workspace.kind)
    if(source===target||target.startsWith(source+paths.sep))throw new Error('Cannot move an item into itself')
    if(workspace.kind==='local'){
        await checkedLocalPath(workspace,source);await checkedLocalPath(workspace,target)
        try{await lstat(target);throw new Error('Destination already exists')}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
        await rename(source,target)
    }else{
        const guard=new RemotePathGuard(workspace.root,(command,signal)=>workspace.run(command,signal))
        await guard.resolve(source,true);await guard.resolve(target,true)
        const from=shellQuote(source),to=shellQuote(target)
        const result=await workspace.run(`if test -e ${to} || test -L ${to}; then echo 'Destination already exists' >&2; exit 1; fi; mv -n -T -- ${from} ${to}; test ! -e ${from} && test ! -L ${from}`)
        if(result.exitCode!==0)throw new Error(result.stderr||'Move failed')
    }
}

export async function deleteWorkspaceItem(workspace:Workspace,input:string):Promise<void> {
    const target=fileActionPath(workspace,input)
    if(workspace.kind==='local')await rm(await checkedLocalPath(workspace,target),{recursive:true})
    else{
        const guard=new RemotePathGuard(workspace.root,(command,signal)=>workspace.run(command,signal))
        await guard.resolve(target,true)
        const result=await workspace.run(`rm -r -- ${shellQuote(target)}`)
        if(result.exitCode!==0)throw new Error(result.stderr||'Delete failed')
    }
}

export function renamedPath(workspace:Workspace,input:string,name:string):string {
    if(!name.trim()||name==='.'||name==='..'||/[\x00-\x1f/\\]/.test(name))throw new Error('Enter a valid file or directory name')
    if(workspace.kind==='local'&&process.platform==='win32'&&(/[<>:"|?*]/.test(name)||/[. ]$/.test(name)))throw new Error('Invalid Windows file name')
    return workspacePath(workspace.kind).join(workspacePath(workspace.kind).dirname(input),name)
}
