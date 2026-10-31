import { wslDirectorySetup } from '../shared/wsl-launch-directory'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import { shellQuote } from '../shared/shell-quote'

/** Keep the CLI on Windows so catalog paths and named-pipe IPC stay in the host OS. */
export const WSL_ARW_BRIDGE = `#!/bin/sh
set -eu
node=$(wslpath -u "$ARW_WSL_NODE")
cwd=$(wslpath -w "$PWD")
exec "$node" "$ARW_WSL_LOADER" "$ARW_WSL_CLI" "$ARW_WSL_CONTEXT" "$cwd" "$@"
`

export const WSL_ARW_LOADER = `const [source,context,cwd,...args]=process.argv.slice(2);
Object.assign(process.env,JSON.parse(context));
process.chdir(cwd);
process.argv=[process.execPath,source,...args];
require(source);
`

export function wslBridgeEnvironment(command:string,env:Record<string,string>,source:string,cwd?:string,
    platform:NodeJS.Platform=process.platform,available:(path:string)=>boolean=existsSync,
):Record<string,string> {
    if(platform!=='win32'||!/(?:^|[\\/])wsl(?:\.exe)?$/i.test(command))return env
    const path=Object.entries(env).find(([name])=>name.toLowerCase()==='path')?.[1]
        ?? process.env.PATH??''
    const node=path.split(';').filter(Boolean).map(directory=>win32.join(directory.replace(/^"|"$/g,''),'node.exe')).find(available)
    if(!node)throw new Error('WSL AI terminals require Windows Node.js on PATH to run the arw bridge')
    const context=Object.fromEntries(Object.entries(env).filter(([key])=>
        (key.startsWith('ARW_')&&!key.startsWith('ARW_WSL_')&&!['ARW_WORKSPACE_ID','ARW_TERMINAL_MODE'].includes(key))||key==='TABBY_CONFIG_DIRECTORY'))
    return {...env,...(cwd?{ARW_WSL_CWD:cwd}:{}),ARW_WSL_NODE:node,ARW_WSL_CLI:source,
        ARW_WSL_LOADER:win32.join(win32.dirname(source),'wsl-bridge.cjs'),
        ARW_WSL_BIN:win32.join(win32.dirname(source),'wsl-bin'),ARW_WSL_CONTEXT:JSON.stringify(context)}
}

export const WSL_USER_BRIDGE_MARKER='# tabby-ai-workspace-manager managed WSL arw bridge'

/** A stable command remains reachable when an AI shell restores an older PATH. */
export function wslUserBridgeScript(env:Record<string,string>):string{
    const context=JSON.parse(env.ARW_WSL_CONTEXT)
    const defaults={ARW_WSL_NODE:env.ARW_WSL_NODE,ARW_WSL_LOADER:env.ARW_WSL_LOADER,
        ARW_WSL_CLI:env.ARW_WSL_CLI,ARW_WSL_CONTEXT:JSON.stringify(context.TABBY_CONFIG_DIRECTORY
            ?{TABBY_CONFIG_DIRECTORY:context.TABBY_CONFIG_DIRECTORY}:{})}
    return '#!/bin/sh\n'+WSL_USER_BRIDGE_MARKER+'\n'+Object.entries(defaults)
        .map(([key,value])=>`if [ -z "\${${key}:-}" ]; then export ${key}=${shellQuote(value)}; fi;`).join('\n')
        +'\n'+WSL_ARW_BRIDGE.split('\n').slice(1).join('\n')
}

export function wslUserBridgeSetup(env:Record<string,string>):string{
    const conflict=`printf '%s\\n' 'Cannot install WSL arw: ~/.local/bin/arw belongs to another program' >&2; exit 1;`
    return [
        '__arw_home_bin="$HOME/.local/bin"; mkdir -p -- "$__arw_home_bin" || exit;',
        '__arw_user="$__arw_home_bin/arw";',
        'if [ -e "$__arw_user" ] || [ -L "$__arw_user" ]; then',
        `if [ ! -L "$__arw_user" ] && [ -f "$__arw_user" ] && grep -Fxq -- ${shellQuote(WSL_USER_BRIDGE_MARKER)} "$__arw_user"; then :;`,
        `else ${conflict} fi; fi;`,
        '__arw_temp=$(mktemp "$__arw_home_bin/.arw.XXXXXXXX") || exit;',
        `printf '%s' ${shellQuote(wslUserBridgeScript(env))} > "$__arw_temp" && chmod 755 "$__arw_temp" && mv -f -- "$__arw_temp" "$__arw_user" || { rm -f -- "$__arw_temp"; exit 1; };`,
        'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac;',
    ].join(' ')+' '
}

export function wslBridgeSetup(env:Record<string,string>={}):string {
    const directory=wslDirectorySetup(env.ARW_WSL_CWD)
    if(!env.ARW_WSL_BIN)return directory
    for(const name of ['ARW_WSL_NODE','ARW_WSL_LOADER','ARW_WSL_CLI','ARW_WSL_CONTEXT']){
        if(!env[name])throw new Error(`Missing WSL arw bridge configuration: ${name}`)
    }
    return directory+['ARW_WSL_NODE','ARW_WSL_LOADER','ARW_WSL_CLI','ARW_WSL_CONTEXT'].map(name=>`export ${name}=${shellQuote(env[name])}; `).join('')
        +`__arw_bin=$(wslpath -u ${shellQuote(env.ARW_WSL_BIN)}) || exit; `
        +'[ -x "$__arw_bin/arw" ] || { printf "WSL arw bridge is missing or not executable: %s\\n" "$__arw_bin/arw" >&2; exit 1; }; '
        +wslUserBridgeSetup(env)
        +'export PATH="$__arw_bin:$PATH"; '
}
