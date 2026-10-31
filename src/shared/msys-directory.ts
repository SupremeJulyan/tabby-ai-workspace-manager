import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { win32 } from 'node:path'

const execute=promisify(execFile)
export function isMsysTerminal(terminal:{profile?:any}):boolean {
    const profile=terminal.profile
    const command=profile?.options?.command??''
    return profile?.type==='local' && (/^(?:.*[\\/])msys2_shell\.(?:cmd|bat)$/i.test(command)
        || /^(?:.*[\\/])(?:bash|zsh|fish)(?:\.exe)?$/i.test(command))
}

/** Use the shell's own runtime to honor /home, /usr and custom MSYS mounts. */
export function msysPathConverter(command:string):string {
    if(!win32.isAbsolute(command))throw new Error('The MSYS shell executable must have an absolute path')
    const directory=win32.dirname(command)
    if(/msys2_shell\.(?:cmd|bat)$/i.test(command))return win32.join(directory,'usr','bin','cygpath.exe')
    // Git for Windows has both bin/bash.exe and usr/bin/bash.exe entry points.
    if(win32.basename(directory).toLowerCase()==='bin'&&win32.basename(win32.dirname(directory)).toLowerCase()!=='usr'){
        return win32.join(directory,'..','usr','bin','cygpath.exe')
    }
    return win32.join(directory,'cygpath.exe')
}
export async function msysWorkspaceDirectory(root:string,command:string,
    convert:(command:string,args:string[])=>Promise<string>=async (file,args)=>(await execute(file,args,{windowsHide:true,timeout:5000})).stdout,
):Promise<string>{
    if(/[\x00-\x1f\x7f]/.test(root))throw new Error('Invalid MSYS directory')
    const result=(await convert(msysPathConverter(command),['-w','--',root])).replace(/\r?\n$/,'')
    if(!/^(?:[a-z]:[\\/]|\\\\)/i.test(result)||/[\x00-\x1f\x7f]/.test(result))throw new Error('Invalid Windows path returned by MSYS')
    return result
}
