import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { workspaceCatalogPath } from '../arw-cli/workspace-catalog'
import { redactSensitiveText } from '../shared/redact'

let writes=Promise.resolve()
export function operationLogPath():string {return join(dirname(workspaceCatalogPath()),'operations.jsonl')}
export function logOperation(operation:string,details:Record<string,unknown>):void {
    const file=operationLogPath()
    const line=redactSensitiveText(JSON.stringify({time:new Date().toISOString(),operation,...details}))+'\n'
    writes=writes.then(async()=>{
        await mkdir(dirname(file),{recursive:true,mode:0o700})
        if(await stat(file).then(info=>info.size,()=>0)>=1024*1024)await rename(file,file+'.1')
        await appendFile(file,line,{mode:0o600})
    }).catch(()=>undefined)
}
export async function flushOperationLog():Promise<void>{await writes}
