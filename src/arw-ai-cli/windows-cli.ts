import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import { t } from '../shared/i18n'

const execute=promisify(execFile)
export interface UserPathStore {read():Promise<string>;write(value:string):Promise<void>}
const powershell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
const prefix="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "
export const windowsUserPath:UserPathStore={
    async read(){
        const script=prefix+"$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); $value=''; if($key){try{$value=$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}finally{$key.Dispose()}}; ConvertTo-Json -Compress -InputObject ([string]$value)"
        const result=await execute(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8'})
        return JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim())
    },
    async write(value){
        const script=prefix+`$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');
try {
    $kind=[Microsoft.Win32.RegistryValueKind]::ExpandString;
    if($key.GetValueNames() -contains 'Path'){$kind=$key.GetValueKind('Path')};
    $key.SetValue('Path',$env:ARW_INSTALL_USER_PATH,$kind)
} finally {$key.Dispose()}
try {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ArwPathNotification { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }';
    $result=[UIntPtr]::Zero;
    [ArwPathNotification]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result) | Out-Null
} catch {}`
        await execute(powershell,['-NoProfile','-NonInteractive','-Command',script],{
            windowsHide:true,encoding:'utf8',env:{...process.env,ARW_INSTALL_USER_PATH:value},
        })
    },
}

export function windowsCliFiles(source:string,home:string):Map<string,string>{
    const bin=join(home,'.tabby-ai-workspace-manager','bin')
    return new Map([
        [join(bin,'arw.cmd'),'@echo off\r\n@rem tabby-ai-workspace-manager managed CLI\r\nsetlocal DisableDelayedExpansion\r\nnode "%~dp0arw-launcher.cjs" %*\r\n'],
        [join(bin,'arw-launcher.cjs'),`require(${JSON.stringify(source)});\n`],
    ])
}
async function read(path:string):Promise<string|undefined>{
    try{return await readFile(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
}
export async function ensureWindowsCli(source:string,home:string):Promise<void>{
    const files=windowsCliFiles(source,home)
    const directory=dirname([...files.keys()][0])
    for(const name of ['arw.exe','arw.bat','arw.ps1']){
        const path=join(directory,name)
        if(await lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})){
            throw new Error(t`已有其他 arw 命令，未覆盖：${path}`)
        }
    }
    for(const [path,content] of files){
        const previous=await read(path)
        if(previous!==undefined&&previous!==content)throw new Error(t`已有其他 arw 命令，未覆盖：${path}`)
    }
    for(const [path,content] of files){
        await mkdir(dirname(path),{recursive:true})
        try{await writeFile(path,content,{flag:'wx'})}
        catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await read(path)!==content)throw error}
    }
}
function pathKey(value:string):string{return win32.normalize(value.trim().replace(/^"|"$/g,'')).replace(/[\\/]+$/,'').toLowerCase()}
export async function installWindowsCli(source:string,home:string,store:UserPathStore=windowsUserPath):Promise<void>{
    await ensureWindowsCli(source,home)
    const directory=dirname([...windowsCliFiles(source,home).keys()][0]),marker=join(directory,'path-owned.json')
    const previous=await store.read(),present=previous.split(';').some(entry=>pathKey(entry)===pathKey(directory))
    const saved=await read(marker)
    const owned=saved?JSON.parse(saved):undefined
    await writeFile(marker,JSON.stringify({source,added:(owned?.source===source&&owned.added===true)||!present}))
    if(!present)await store.write(previous+(previous&&!previous.endsWith(';')?';':'')+directory)
}
export async function uninstallWindowsCli(source:string,home:string,store:UserPathStore=windowsUserPath):Promise<void>{
    const files=windowsCliFiles(source,home)
    for(const [path,content] of files)if(await read(path)!==content)return
    const directory=dirname([...files.keys()][0]),marker=join(directory,'path-owned.json'),saved=await read(marker)
    const owned=saved?JSON.parse(saved):undefined
    if(owned?.source===source&&owned.added===true){
        const previous=await store.read(),next=previous.split(';').filter(entry=>pathKey(entry)!==pathKey(directory)).join(';')
        if(previous!==next)await store.write(next)
    }
    for(const path of files.keys())await rm(path,{force:true})
    await rm(marker,{force:true})
}
