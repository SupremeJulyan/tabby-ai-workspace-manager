import { lstat, readdir, readFile, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { agentCwdPath, legacyAgentCwdPath, removeLegacyAgentMetadata } from './agent-cwd'
import { removeGeneratedAgentGuidance } from '../arw-cli/instructions'

const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
async function plainDirectory(path:string):Promise<boolean> {
    try{return (await lstat(path)).isDirectory()}catch(error){if(missing(error))return false;throw error}
}

/** Inspect flat placeholders and the legacy two-level tree; never follow links. */
export async function cleanupLegacyPlaceholders(configDirectory:string):Promise<void> {
    const storage=join(configDirectory,'awm'),root=join(storage,'agent-cwd')
    if(!await plainDirectory(storage)||!await plainDirectory(root))return
    const placeholders:string[]=[]
    for(const endpoint of await readdir(root,{withFileTypes:true})){
        if(!endpoint.isDirectory())continue
        const endpointPath=join(root,endpoint.name)
        if(/^[^@]*@[0-9]+@[^@]*$/.test(endpoint.name)){placeholders.push(endpointPath);continue}
        for(const entry of await readdir(endpointPath,{withFileTypes:true})){
            if(!entry.isDirectory()||!/^[a-f0-9]{16}(?:-terminal(?:-[a-f0-9]{16})?)?$/.test(entry.name))continue
            placeholders.push(join(endpointPath,entry.name))
        }
    }
    for(const placeholder of placeholders){
        try{
            removeGeneratedAgentGuidance(placeholder)
            const directory=join(placeholder,'.awm')
            if(!await plainDirectory(directory))continue
            const file=join(directory,'workspace.json')
            try{
                const info=await lstat(file)
                if(info.isFile()&&info.size<65536){
                    let metadata:any
                    try{metadata=JSON.parse(await readFile(file,'utf8'))}catch{continue}
                    if(metadata?.version===2)continue
                    if(typeof metadata?.remoteRoot==='string'&&typeof metadata.host==='string'){
                        const matches=[agentCwdPath,legacyAgentCwdPath].some(make=>make(metadata.remoteRoot,storage,metadata,metadata.terminalOnly===true,metadata.workspaceId)===placeholder)
                        if(matches)removeLegacyAgentMetadata(placeholder,metadata.remoteRoot)
                    }
                }
            }catch(error){if(!missing(error))throw error}
            try{await rmdir(directory)}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code??''))throw error}
        }catch(error){console.warn('ARW: could not clean legacy placeholder',placeholder,String(error))}
    }
}
