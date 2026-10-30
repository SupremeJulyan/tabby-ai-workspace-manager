import { shellQuote } from '../shared/shell-quote'

export type ShellType = 'unix' | 'powershell' | 'cmd'
export type ShellFamily = ShellType | 'wsl' | 'msys2'

export interface AgentShell {
    id?: string
    name?: string
    command: string
    args?: string[]
    env?: Record<string,string>
    shellType?: ShellType|null
}

export interface ShellCommand {
    command: string
    args: string[]
    env: Record<string,string>
    shellType: ShellType|null
}

function baseName (command:string):string {
    return command.replace(/\\/g,'/').split('/').pop()?.toLowerCase()??''
}

function isWindowsPath (command:string):boolean {
    return /^[A-Za-z]:[\\/]/.test(command)||command.includes('\\')
}

/** Classify the selected Tabby profile by the shell it actually starts. */
export function shellFamily (shell:Pick<AgentShell,'command'|'shellType'>):ShellFamily {
    const name=baseName(shell.command)
    if (name==='wsl'||name==='wsl.exe') return 'wsl'
    if (name==='msys2_shell.cmd'||name==='msys2_shell.bat') return 'msys2'
    if (name==='cmd'||name==='cmd.exe') return 'cmd'
    if (name==='powershell'||name==='powershell.exe'||name==='pwsh'||name==='pwsh.exe') return 'powershell'
    if (shell.shellType==='cmd'||shell.shellType==='powershell'||shell.shellType==='unix') return shell.shellType
    if (/^(bash|zsh|fish|sh|dash|ash|ksh|mksh|tcsh|csh)$/.test(name.replace(/\.exe$/,''))) return 'unix'
    if (isWindowsPath(shell.command)) return 'cmd'
    return 'unix'
}

function shellName (shell:Pick<AgentShell,'command'|'shellType'>):string {
    return baseName(shell.command).replace(/\.exe$/,'')
}

function shellTypeOf (family:ShellFamily):ShellType {
    return family==='powershell'?'powershell':family==='cmd'?'cmd':'unix'
}

export function shellEnvironment (shell:AgentShell,applied:Record<string,string>):Record<string,string> {
    const result:Record<string,string>={}
    const keys=new Map<string,string>()
    for (const entry of [shell.env??{},applied]) {
        for (const [name,value] of Object.entries(entry)) {
            if (typeof value!=='string') continue
            const key=name.toLowerCase()
            const stored=keys.get(key)
            if (stored!==undefined) delete result[stored]
            keys.set(key,name)
            result[name]=value
        }
    }
    return result
}

/** Find PATH regardless of the casing Windows shell profiles use. */
export function shellPathEnvironment (shell:AgentShell):string {
    for (const [name,value] of Object.entries(shellEnvironment(shell,{}))) {
        if (name.toLowerCase()==='path'&&value) return value
    }
    return process.env.PATH??''
}

function interactiveArgument (args:string[]):boolean {
    return args.some(argument=>argument==='--interactive'||/^-{1}[A-Za-z]*i[A-Za-z]*$/.test(argument))
}

function withoutCommandArgument (args:string[]):string[] {
    let index=-1
    for (let position=0;position<args.length;position++) {
        const argument=args[position].toLowerCase()
        if (argument==='-c'||argument==='--command'||argument==='-command') { index=position; break }
        if (argument.startsWith('--command=')) return args.slice(0,position)
    }
    return index<0?args.slice():args.slice(0,index)
}

function posixLine (tokens:string[]):string {
    return tokens.map(shellQuote).join(' ')
}

function powershellQuote (value:string):string {
    return `'${value.replace(/'/g,"''")}'`
}

function powershellLine (tokens:string[]):string {
    return `& ${tokens.map(powershellQuote).join(' ')}`
}

function cmdQuote (value:string):string {
    if (value.length===0) return '""'
    if (!/[ \t\n&|<>^"%!]/.test(value)) return value
    return `"${value.replace(/"/g,'""')}"`
}

function cmdLine (tokens:string[]):string {
    return tokens.map(cmdQuote).join(' ')
}

function posixArguments (args:string[],tokens:string[]):string[] {
    const prefix=withoutCommandArgument(args)
    if (!interactiveArgument(prefix)) prefix.push('-i')
    prefix.push('-c',`exec ${posixLine(tokens)}`)
    return prefix
}

function powershellArguments (args:string[],tokens:string[]):string[] {
    const prefix:string[]=[]
    let initialization=''
    for (let position=0;position<args.length;position++) {
        const argument=args[position]
        const lower=argument.toLowerCase()
        if (lower==='-noexit') continue
        if (lower==='-command'||lower==='-c'||lower==='-commandwithargs') {
            if (position+1<args.length) initialization=args[++position]
            continue
        }
        if (lower.startsWith('-command=')) { initialization=argument.slice(argument.indexOf('=')+1); continue }
        if (lower.startsWith('-c=')) { initialization=argument.slice(3); continue }
        prefix.push(argument)
    }
    const invoke=powershellLine(tokens)
    prefix.push('-Command',initialization?`${initialization}; ${invoke}`:invoke)
    return prefix
}

function cmdArguments (args:string[],tokens:string[]):string[] {
    let separator=-1
    for (let position=0;position<args.length;position++) {
        const argument=args[position].toLowerCase()
        if (argument==='/c'||argument==='/k') { separator=position; break }
    }
    const prefix=separator<0?args.slice():args.slice(0,separator)
    const initialization=separator<0?[]:args.slice(separator+1)
    const command=initialization.length>0?`${cmdLine(initialization)} && ${cmdLine(tokens)}`:cmdLine(tokens)
    prefix.push('/s','/c',command)
    return prefix
}

function wslArguments (args:string[],tokens:string[]):string[] {
    const prefix=args.slice()
    const hasExec=prefix.some(argument=>argument==='--'||argument==='-e'||argument==='--exec')
    if (!hasExec) prefix.push('--')
    prefix.push('bash','-l','-i','-c',`exec ${posixLine(tokens)}`)
    return prefix
}

/** Build a shell invocation that starts the AI CLI inside the selected shell. */
export function shellCommand (shell:ShellCommand,agentArgs:string[]):ShellCommand {
    const family=shellFamily(shell)
    const args=shell.args.slice()
    const tokens=agentArgs.slice()
    let invocation:string[]
    switch (family) {
        case 'powershell': invocation=powershellArguments(args,tokens); break
        case 'cmd': invocation=cmdArguments(args,tokens); break
        case 'wsl': invocation=wslArguments(args,tokens); break
        case 'msys2': invocation=withoutCommandArgument(args).concat(['-c',`exec ${posixLine(tokens)}`]); break
        default: invocation=posixArguments(args,tokens)
    }
    return {command:shell.command,args:invocation,env:shell.env,shellType:shellTypeOf(family)}
}

/**
 * Replace only the AI command in an invocation saved by an older plugin version.
 * New tabs store the original shell profile and rebuild through shellCommand().
 */
export function replaceShellArguments (shell:ShellCommand,agentArgs:string[]):ShellCommand {
    const family=shellFamily(shell)
    const candidates=family==='cmd'?['/c','/k']:family==='powershell'?['-command','-c']:['-c','--command']
    let index=-1
    for (let position=shell.args.length-1;position>=0;position--) {
        if (candidates.includes(shell.args[position].toLowerCase())) { index=position; break }
    }
    if (index<0) return shellCommand(shell,agentArgs)
    const replacement=family==='powershell'?powershellLine(agentArgs):family==='cmd'?cmdLine(agentArgs):`exec ${posixLine(agentArgs)}`
    return {command:shell.command,args:shell.args.slice(0,index+1).concat([replacement]),env:shell.env,shellType:shell.shellType}
}

function quoteLine (values:string[]):string {return values.map(shellQuote).join(' ')}

/** Quote a complete, already-wrapped shell invocation; human-readable diagnostics only. */
export function shellCommandLine (shell:ShellCommand):string {
    return [shell.command].concat(shell.args).map(shellQuote).join(' ')
}

/** Quote the AI command and its arguments as one POSIX shell command. */
export function shellArgumentLine (args:string[]):string {
    return quoteLine(args)
}
