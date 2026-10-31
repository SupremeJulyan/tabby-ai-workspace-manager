import { lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { ensureUserCli } from './user-cli'
import { installWindowsCli, uninstallWindowsCli, type UserPathStore } from './windows-cli'
import { cleanupLegacyPlaceholders } from './legacy-cleanup'

export interface CliInstallOptions {platform?:NodeJS.Platform;userPath?:UserPathStore;configDirectory?:string}

export function installationConfigDirectory(source:string,home:string,options:CliInstallOptions={}):string {
    if(options.configDirectory)return options.configDirectory
    if(home===homedir()&&process.env.TABBY_CONFIG_DIRECTORY)return process.env.TABBY_CONFIG_DIRECTORY
    const modules=dirname(dirname(dirname(source))),plugins=dirname(modules)
    if(basename(modules)==='node_modules'&&basename(plugins)==='plugins')return dirname(plugins)
    const platform=options.platform??process.platform
    if(platform==='darwin')return join(home,'Library','Application Support','tabby')
    if(platform==='win32')return join(home===homedir()?process.env.APPDATA??join(home,'AppData','Roaming'):join(home,'AppData','Roaming'),'tabby')
    return join(home===homedir()?process.env.XDG_CONFIG_HOME??join(home,'.config'):join(home,'.config'),'tabby')
}

const begin='# >>> tabby-ai-workspace-manager PATH >>>'
const end='# <<< tabby-ai-workspace-manager PATH <<<'
const block=`${begin}\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac\n${end}\n`
const fishBlock=`${begin}\nif not contains -- "$HOME/.local/bin" $PATH\n    set -gx PATH "$HOME/.local/bin" $PATH\nend\n${end}\n`
async function read(path:string):Promise<string> {
    try{return await readFile(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return ''}
}
async function configs(home:string):Promise<Array<[string,string]>> {
    const files=['.profile','.bashrc','.zshrc','.zprofile']
    for(const file of ['.bash_profile','.bash_login']){
        if(await lstat(join(home,file)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error}))files.push(file)
    }
    return files.map(file=>[join(home,file),block] as [string,string]).concat([
        [join(home,'.config/fish/conf.d/tabby-ai-workspace-manager.fish'),fishBlock],
    ])
}
export async function installUserCli(source:string,home=homedir(),path=process.env.PATH??'',options:CliInstallOptions={}):Promise<void> {
    const platform=options.platform??process.platform
    await cleanupLegacyPlaceholders(installationConfigDirectory(source,home,options))
    if(platform==='win32')return installWindowsCli(source,home,options.userPath)
    await ensureUserCli(source,home,platform)
    if(path.split(delimiter).includes(join(home,'.local/bin')))return
    for(const [file,content] of await configs(home)){
        const previous=await read(file)
        if(previous.includes(begin))continue
        await mkdir(dirname(file),{recursive:true})
        await writeFile(file,previous+(previous&&!previous.endsWith('\n')?'\n':'')+content,{mode:0o600})
    }
}
export async function uninstallUserCli(source:string,home=homedir(),options:CliInstallOptions={}):Promise<void> {
    if((options.platform??process.platform)==='win32')return uninstallWindowsCli(source,home,options.userPath)
    const command=join(home,'.local/bin/arw')
    if(await readlink(command).catch(()=>'')!==source)return
    await rm(command,{force:true})
    for(const [file,content] of await configs(home)){
        const previous=await read(file)
        if(!previous.includes(content))continue
        const next=previous.replace(content,'')
        if(!next&&file.endsWith('.fish'))await rm(file,{force:true})
        else await writeFile(file,next)
    }
}

/** Tabby removes packages through PlatformService; app shutdown must keep the CLI installed. */
export function attachCliUninstall(platform:{uninstallPlugin(name:string):Promise<void>},source:string,home=homedir()):()=>void {
    const original=platform.uninstallPlugin
    const wrapped=async function(this:typeof platform,name:string):Promise<void>{
        await original.call(this,name)
        if(name==='tabby-ai-workspace-manager')await uninstallUserCli(source,home)
    }
    platform.uninstallPlugin=wrapped
    return ()=>{if(platform.uninstallPlugin===wrapped)platform.uninstallPlugin=original}
}
