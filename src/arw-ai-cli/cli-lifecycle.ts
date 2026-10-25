import { mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { ensureUserCli } from './user-cli'

const begin='# >>> tabby-ai-workspace-manager PATH >>>'
const end='# <<< tabby-ai-workspace-manager PATH <<<'
const block=`${begin}\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac\n${end}\n`
const fishBlock=`${begin}\nif not contains -- "$HOME/.local/bin" $PATH\n    set -gx PATH "$HOME/.local/bin" $PATH\nend\n${end}\n`
async function read(path:string):Promise<string> {
    try{return await readFile(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return ''}
}
function configs(home:string):Array<[string,string]> {
    return ['.profile','.bashrc','.zshrc'].map(file=>[join(home,file),block] as [string,string]).concat([
        [join(home,'.config/fish/conf.d/tabby-ai-workspace-manager.fish'),fishBlock],
    ])
}
export async function installUserCli(source:string,home=homedir(),path=process.env.PATH??''):Promise<void> {
    if(process.platform==='win32')return
    await ensureUserCli(source,home)
    if(path.split(delimiter).includes(join(home,'.local/bin')))return
    for(const [file,content] of configs(home)){
        const previous=await read(file)
        if(previous.includes(begin))continue
        await mkdir(dirname(file),{recursive:true})
        await writeFile(file,previous+(previous&&!previous.endsWith('\n')?'\n':'')+content,{mode:0o600})
    }
}
export async function uninstallUserCli(source:string,home=homedir()):Promise<void> {
    if(process.platform==='win32')return
    const command=join(home,'.local/bin/arw')
    if(await readlink(command).catch(()=>'')!==source)return
    await rm(command,{force:true})
    for(const [file,content] of configs(home)){
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
