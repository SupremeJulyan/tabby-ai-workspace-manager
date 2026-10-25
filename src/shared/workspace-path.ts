import { posix, win32 } from 'node:path'

export function workspacePath(kind:'local'|'remote',platform:NodeJS.Platform=process.platform){
    return kind==='local'&&platform==='win32'?win32:posix
}

export function parentWorkspacePath(path:string,kind:'local'|'remote',platform:NodeJS.Platform=process.platform):string {
    if(!path)return ''
    const parent=workspacePath(kind,platform).dirname(path)
    return parent==='.'?'':parent
}
