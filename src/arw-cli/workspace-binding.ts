import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export interface WorkspaceBinding {
    version:2
    kind:'remote'
    workspaceId:string
    remoteRoot:string
    host:string
    port:number
    user:string
    terminalOnly:boolean
    catalogPath?:string
}

/** Exact-directory lookup: never inspect ancestors or ARW_WORKSPACE_* variables. */
export function readWorkspaceBinding(directory:string,allowLegacy=false):WorkspaceBinding|undefined {
    const metadata=join(directory,'.awm'),file=join(metadata,'workspace.json')
    try{
        if(!lstatSync(metadata).isDirectory())throw new Error('Workspace binding directory must not be a symbolic link')
        const info=lstatSync(file)
        if(!info.isFile()||info.size>65536)throw new Error('Workspace binding must be a small regular file')
        const value=JSON.parse(readFileSync(file,'utf8'))
        if(allowLegacy&&value?.version===1)return undefined
        if(value?.version!==2||value.kind!=='remote'||typeof value.workspaceId!=='string'||!value.workspaceId
            ||typeof value.remoteRoot!=='string'||!value.remoteRoot.startsWith('/')||typeof value.host!=='string'||!value.host
            ||!Number.isInteger(value.port)||value.port<1||value.port>65535||typeof value.user!=='string'||typeof value.terminalOnly!=='boolean'
            ||value.catalogPath!==undefined&&(typeof value.catalogPath!=='string'||!isAbsolute(value.catalogPath)))
            throw new Error('Invalid .awm/workspace.json binding; reopen this AI terminal')
        return value
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
}

export function writeWorkspaceBinding(directory:string,binding:WorkspaceBinding):void {
    const previous=readWorkspaceBinding(directory)
    if(previous){
        if(['workspaceId','remoteRoot','host','port','user','terminalOnly','catalogPath'].some(key=>previous[key as keyof WorkspaceBinding]!==binding[key as keyof WorkspaceBinding]))
            throw new Error('Placeholder already belongs to another workspace binding')
        return
    }
    mkdirSync(join(directory,'.awm'),{recursive:true,mode:0o700})
    writeFileSync(join(directory,'.awm','workspace.json'),JSON.stringify(binding,null,2)+'\n',{mode:0o600,flag:'wx'})
}
