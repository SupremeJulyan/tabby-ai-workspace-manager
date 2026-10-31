import { isMsysTerminal, msysWorkspaceDirectory } from './msys-directory'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const conversions=new WeakMap<object,{key:string;path:Promise<string>}>()
export function isWslTerminal(terminal:{profile?:any}):boolean {
    const profile=terminal.profile
    return profile?.type==='local' && /(?:^|[\\/])wsl(?:\.exe)?$/i.test(profile.options?.command??'')
}

/** Resolve inside the selected distribution, including its custom automount settings. */
export async function terminalWorkspaceDirectory(
    terminal:{profile?:any;session?:{getWorkingDirectory():Promise<string|null>}|null},
    platform:NodeJS.Platform=process.platform,
    convert:(args:string[])=>Promise<string>=async args=>(await execute('wsl.exe',args,{windowsHide:true,timeout:5000})).stdout,
):Promise<string|undefined> {
    const root=await terminal.session?.getWorkingDirectory()
    if(!root)return undefined
    if(platform!=='win32'||!root.startsWith('/'))return root
    if(isMsysTerminal(terminal)){
        const key=JSON.stringify([terminal.profile.options.command,root])
        const cached=conversions.get(terminal.session!)
        if(cached?.key===key)return cached.path
        const path=msysWorkspaceDirectory(root,terminal.profile.options.command)
        const entry={key,path}
        conversions.set(terminal.session!,entry)
        path.catch(()=>{if(conversions.get(terminal.session!)===entry)conversions.delete(terminal.session!)})
        return path
    }
    if(!isWslTerminal(terminal))return root
    if(/[\x00-\x1f\x7f]/.test(root))throw new Error('Invalid WSL directory')
    const args:string[]=terminal.profile.options.args??[]
    const distribution=args.findIndex(arg=>arg==='-d'||arg==='--distribution')
    const inline=args.find(arg=>arg.startsWith('--distribution='))?.slice('--distribution='.length)
    const name=distribution>=0?args[distribution+1]:inline
    const prefix=name?['--distribution',name]:[]
    const key=JSON.stringify([name,root])
    const cached=conversions.get(terminal.session!)
    if(cached?.key===key)return cached.path
    const path=(async()=>{
        const result=(await convert([...prefix,'--exec','wslpath','-w',root])).replace(/\r?\n$/,'')
        if(!/^(?:[a-z]:[\\/]|\\\\)/i.test(result)||/[\x00-\x1f\x7f]/.test(result))throw new Error('Invalid Windows path returned by WSL')
        return result
    })()
    const entry={key,path}
    conversions.set(terminal.session!,entry)
    path.catch(()=>{if(conversions.get(terminal.session!)===entry)conversions.delete(terminal.session!)})
    return path
}
