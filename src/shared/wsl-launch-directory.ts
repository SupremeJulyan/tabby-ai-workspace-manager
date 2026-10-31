import { shellQuote } from './shell-quote'

export function wslLaunchDirectory(root:string):{directory:string;distribution?:string;native:boolean}{
    if(!root||/[\x00-\x1f\x7f]/.test(root))throw new Error('Invalid WSL startup directory')
    const unc=/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(root.replace(/\//g,'\\'))
    if(unc)return {directory:'/'+(unc[2]??'').replace(/\\/g,'/'),distribution:unc[1],native:true}
    if(root.startsWith('/'))return {directory:root,native:true}
    if(/^(?:[a-z]:[\\/]|\\\\)/i.test(root))return {directory:root,native:false}
    throw new Error('WSL startup directory must be absolute')
}

/** Set the workspace before --/--exec without changing the selected/default distro. */
export function wslDirectoryArguments(args:string[],root?:string):string[]{
    if(!root)return args.slice()
    const {directory}=wslLaunchDirectory(root)
    const boundary=args.findIndex(arg=>['--','--exec','-e'].includes(arg))
    const before=boundary<0?args:args.slice(0,boundary),prefix:string[]=[]
    for(let i=0;i<before.length;i++){
        const arg=before[i]
        if(arg==='--cd'){i++;continue}
        if(arg.startsWith('--cd='))continue
        prefix.push(arg)
    }
    prefix.push('--cd',directory)
    return prefix.concat(boundary<0?[]:args.slice(boundary))
}

/** Login scripts can cd again, so establish the workspace after shell initialization too. */
export function wslDirectorySetup(root?:string):string{
    if(!root)return ''
    const {directory,native}=wslLaunchDirectory(root)
    const target=native?shellQuote(directory):`"$(wslpath -u ${shellQuote(directory)})"`
    return `cd -- ${target} || exit; `
}
