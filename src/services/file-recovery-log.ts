import { appendFile, chmod, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { workspaceCatalogPath } from '../arw-cli/workspace-catalog'
import { redactSensitiveText } from '../shared/redact'

let writes=Promise.resolve()

export function fileRecoveryLogPath():string {
    return join(dirname(workspaceCatalogPath()),'file-recovery.jsonl')
}

export function logFileRecovery(event:string,details:Record<string,unknown>):void {
    const file=fileRecoveryLogPath()
    const line=redactSensitiveText(JSON.stringify({time:new Date().toISOString(),pid:process.pid,event,...details}))+'\n'
    writes=writes.then(async()=>{
        await mkdir(dirname(file),{recursive:true,mode:0o700})
        const size=await stat(file).then(info=>info.size,error=>{if(error.code==='ENOENT')return 0;throw error})
        if(size>=1024*1024)await rename(file,file+'.1')
        await appendFile(file,line,{mode:0o600})
        await chmod(file,0o600)
    }).catch(()=>undefined)
}

export async function flushFileRecoveryLog():Promise<void> {await writes}
