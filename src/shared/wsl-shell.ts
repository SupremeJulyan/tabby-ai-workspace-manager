/** Load the guest user's shell environment, then run our POSIX script portably. */
export function wslShellArguments(command:string,interactive=false):string[]{
    return ['sh','-c',
        `export ARW_WSL_SCRIPT="$1"; exec "\${SHELL:-/bin/sh}" -l ${interactive?'-i ':''}-c 'exec sh -c "$ARW_WSL_SCRIPT"'`,
        'arw-wsl',command]
}
