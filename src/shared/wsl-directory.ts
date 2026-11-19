import { wslLaunchDirectory } from './wsl-launch-directory'
import { isMsysTerminal, msysWorkspaceDirectory } from './msys-directory'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const displayPaths=new WeakMap<object,Map<string,Promise<string>>>()
const conversions=new WeakMap<object,{key:string;path:Promise<string>}>()
export function isWslTerminal(terminal:{profile?:any}):boolean {
    const profile=terminal.profile
    return profile?.type==='local' && /(?:^|[\\/])wsl(?:\.exe)?$/i.test(profile.options?.command??'')
}

function distributionArguments(terminal:{profile?:any}):string[]{
    const args:string[]=terminal.profile?.options?.args??[]
    const index=args.findIndex(arg=>arg==='-d'||arg==='--distribution')
    const name=index>=0?args[index+1]:args.find(arg=>arg.startsWith('--distribution='))?.slice('--distribution='.length)
    return name?['--distribution',name]:[]
}
function wslProfileArguments(terminal:{profile?:any}):string[]{
    const args:string[]=terminal.profile?.options?.args??[],result:string[]=[]
    for(let i=0;i<args.length;i++){
        const value=args[i]
        if(value==='--'||value==='--exec'||value==='-e')break
        if(value==='-d'||value==='--distribution'||value==='-u'||value==='--user'){
            if(args[i+1])result.push(value,args[++i])
        }else if(value.startsWith('--distribution=')||value.startsWith('--user='))result.push(value)
        else if(value==='--cd'){i++}
        else if(value.startsWith('--cd='))continue
    }
    return result
}
function rememberDisplayPath(terminal:{session?:object|null},root:string,path:Promise<string>):void{
    const owner=terminal.session??terminal,paths=displayPaths.get(owner)??new Map<string,Promise<string>>()
    if(paths.size>=32)paths.delete(paths.keys().next().value!)
    paths.set(root,path);displayPaths.set(owner,paths)
    void path.catch(()=>{if(paths.get(root)===path)paths.delete(root)})
}

/** UI paths stay native to WSL; filesystem APIs keep Windows drive/UNC paths. */
export async function terminalWorkspaceDisplayPath(
    terminal:{profile?:any;session?:object|null},root:string,
    platform:NodeJS.Platform=process.platform,
    convert:(args:string[])=>Promise<string>=async args=>(await execute('wsl.exe',args,{windowsHide:true,timeout:5000})).stdout,
):Promise<string>{
    if(platform!=='win32'||!isWslTerminal(terminal)||root.startsWith('/'))return root
    const parsed=wslLaunchDirectory(root)
    if(parsed.native)return parsed.directory
    const prefix=distributionArguments(terminal),key=JSON.stringify([prefix,root])
    const cached=displayPaths.get(terminal.session??terminal)?.get(key)
    if(cached)return cached
    const path=(async()=>{
        const result=(await convert([...prefix,'--exec','wslpath','-u',root])).replace(/\r?\n$/,'')
        if(!result.startsWith('/')||/[\x00-\x1f\x7f]/.test(result))throw new Error('Invalid Linux path returned by WSL')
        return result
    })()
    rememberDisplayPath(terminal,key,path)
    return path
}

/** Resolve a user-entered guest path using the terminal's own filesystem. */
export async function resolveTerminalWorkspacePath(
    terminal:{profile?:any;session?:object|null},root:string,
    platform:NodeJS.Platform=process.platform,
    convert:(args:string[])=>Promise<string>=async args=>(await execute('wsl.exe',args,{windowsHide:true,timeout:5000})).stdout,
):Promise<string> {
    if(platform!=='win32'||!root.startsWith('/'))return root
    if(isMsysTerminal(terminal)){
        const key=JSON.stringify([terminal.profile.options.command,root])
        const cached=conversions.get(terminal.session??terminal)
        if(cached?.key===key)return cached.path
        const path=msysWorkspaceDirectory(root,terminal.profile.options.command)
        const entry={key,path}
        conversions.set(terminal.session??terminal,entry)
        path.catch(()=>{if(conversions.get(terminal.session??terminal)===entry)conversions.delete(terminal.session??terminal)})
        return path
    }
    if(!isWslTerminal(terminal))return root
    if(/[\x00-\x1f\x7f]/.test(root))throw new Error('Invalid WSL directory')
    const prefix=distributionArguments(terminal)
    const key=JSON.stringify([prefix,root])
    const cached=conversions.get(terminal.session??terminal)
    if(cached?.key===key)return cached.path
    const path=(async()=>{
        const result=(await convert([...prefix,'--exec','wslpath','-w',root])).replace(/\r?\n$/,'')
        if(!/^(?:[a-z]:[\\/]|\\\\)/i.test(result)||/[\x00-\x1f\x7f]/.test(result))throw new Error('Invalid Windows path returned by WSL')
        rememberDisplayPath(terminal,JSON.stringify([prefix,result]),Promise.resolve(root))
        return result
    })()
    const entry={key,path}
    conversions.set(terminal.session??terminal,entry)
    path.catch(()=>{if(conversions.get(terminal.session??terminal)===entry)conversions.delete(terminal.session??terminal)})
    return path
}

/** Resolve the configured WSL user's home without consulting the interactive terminal cwd. */
export async function wslHomeDirectory(
    terminal:{profile?:any;session?:object|null},
    platform:NodeJS.Platform=process.platform,
    convert:(args:string[])=>Promise<string>=async args=>(await execute('wsl.exe',args,{windowsHide:true,timeout:5000})).stdout,
):Promise<string|undefined>{
    if(platform!=='win32'||!isWslTerminal(terminal))return undefined
    const result=(await convert([...wslProfileArguments(terminal),'--exec','sh','-lc','printf %s "$HOME"'])).replace(/\r?\n$/,'')
    if(!result.startsWith('/')||/[\x00-\x1f\x7f]/.test(result))throw new Error('Invalid WSL home directory')
    return resolveTerminalWorkspacePath(terminal,result,platform,convert)
}
