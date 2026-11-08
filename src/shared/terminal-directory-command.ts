import { shellQuote } from './shell-quote'
import { isMsysTerminal } from './msys-directory'
import { isWslTerminal } from './wsl-directory'

interface TerminalProfile {profile?:{type?:string;options?:{command?:string;shellType?:string|null}}}

/** Quote for Fish, whose single quotes also interpret escaped backslashes. */
export function fishQuote(value:string):string {
    return `'${value.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`
}

/** Select syntax from the terminal shell, independently of the host platform. */
export function terminalDirectoryCommand(terminal:TerminalProfile,root:string):string {
    if(!root||/[\x00-\x1f\x7f]/.test(root))throw new Error('Invalid terminal directory')
    const options=terminal.profile?.options
    const executable=(options?.command??'').replace(/\\/g,'/').split('/').pop()?.toLowerCase().replace(/\.exe$/,'')??''
    const windowsPath=/^(?:[a-z]:[\\/]|\\\\)/i.test(root)
    const msys=isMsysTerminal(terminal)&&(process.platform==='win32'||/^(?:[a-z]:|.*\\)|\.exe$|msys2_shell/i.test(options?.command??''))
    const converter=isWslTerminal(terminal)?'wslpath':msys?'cygpath':undefined
    const powershell=['powershell','pwsh'].includes(executable)
    const cmd=executable==='cmd'
    // An explicit executable takes precedence over a stale shellType hint.
    const unix=['bash','zsh','fish','sh','dash','ash','ksh','mksh','csh','tcsh'].includes(executable)
    const shell=powershell?'powershell':cmd?'cmd':converter||unix?'unix':options?.shellType??'unix'
    if(shell==='powershell')return `cd -LiteralPath '${root.replace(/'/g,"''")}'`
    if(shell==='cmd'){
        // Expansion of %VAR% and delayed !VAR! cannot be disabled by quoting.
        if(/["%!]/.test(root))throw new Error('CMD cannot safely change to a path containing quotes, % or !; use PowerShell')
        return root.startsWith('\\\\')?`pushd "${root}"`:`cd /d "${root}"`
    }
    if(windowsPath&&!converter)throw new Error('A Windows directory requires a PowerShell, CMD, WSL or MSYS shell profile')
    const quote=executable==='fish'?fishQuote:shellQuote
    const directory=converter&&windowsPath?`"$(${converter} -u ${quote(root)})"`:quote(root)
    return `cd -- ${directory}`
}
