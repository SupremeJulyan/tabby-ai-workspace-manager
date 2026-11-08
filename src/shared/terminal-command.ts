import type { BaseTerminalTabComponent } from 'tabby-terminal'
import type { GitResult } from '../arw-tree/git/remote-git'
import type { RemoteShell } from './shell-integration'

const modes=new WeakMap<object,{enabled:boolean;controller:AbortController;shell:RemoteShell}>()
const running=new WeakSet<object>()
export function setTerminalCommandMode(tab:object,enabled:boolean,shell:RemoteShell='bash'):void {
    modes.get(tab)?.controller.abort(new Error('Terminal mode stopped'))
    modes.set(tab,{enabled,controller:new AbortController(),shell})
}
export function isTerminalCommandMode(tab:object):boolean {return modes.get(tab)?.enabled??false}

type Terminal=BaseTerminalTabComponent<any>
/** Send the original command to the existing PTY and collect output between shell events. */
export async function runTerminalCommand(tab:Terminal,root:string,command:string,signal:AbortSignal,maxBytes=8*1024*1024):Promise<GitResult> {
    const mode=modes.get(tab),session=tab.session
    if(!mode?.enabled)throw new Error('Terminal mode is not enabled')
    if(!session?.open||tab.alternateScreenActive)throw new Error('Return to the connected shell prompt before running a command')
    if(running.has(tab))throw new Error('Another Agent command is already running in this terminal')
    command=command.replace(/\r\n/g,'\n')
    if(!command.trim())throw new Error('Terminal command is empty')
    if(/[\x00-\x08\x0b-\x1f\x7f]/.test(command))throw new Error('Terminal command contains control characters')
    const combined=AbortSignal.any([signal,mode.controller.signal,AbortSignal.timeout(120000)])
    combined.throwIfAborted()
    running.add(tab)
    try {
        const cwd=await session.getWorkingDirectory()
        combined.throwIfAborted()
        if(cwd!==root)throw new Error('Terminal directory changed. Follow its current directory and reopen the AI terminal')
        if(tab.session!==session)throw new Error('Terminal session changed')
        return await new Promise<GitResult>((resolve,reject)=>{
            let buffer='',bytes=0,settled=false
            let idle:ReturnType<typeof setTimeout>|undefined
            const subscriptions:Array<{unsubscribe():void}>=[]
            const finish=(error?:unknown,result?:GitResult)=>{
                if(settled)return
                settled=true;clearTimeout(idle);combined.removeEventListener('abort',abort)
                subscriptions.forEach(subscription=>subscription.unsubscribe())
                if(error)reject(error);else resolve(result!)
            }
            const interrupt=()=>{if(tab.session===session&&session.open)tab.sendInput('\x03')}
            const abort=()=>{try{interrupt()}finally{finish(combined.reason??new Error('Terminal command canceled'))}}
            // Tabby exposes streams, not command completion or exit status. Quiet
            // output is only a capture boundary, and must not imply success.
            const schedule=()=>{
                clearTimeout(idle)
                idle=setTimeout(()=>finish(undefined,{stdout:buffer.replace(/\r\n/g,'\n'),stderr:'',exitCode:null}),1000)
            }
            subscriptions.push(session.output$.subscribe(chunk=>{
                bytes+=Buffer.byteLength(chunk)
                if(bytes>maxBytes){try{interrupt()}finally{finish(new Error('Terminal command output exceeded the capture limit'))};return}
                buffer+=chunk;schedule()
            }))
            subscriptions.push(tab.input$.subscribe(()=>schedule()))
            subscriptions.push(session.closed$.subscribe(()=>finish(new Error('Terminal closed before the command completed'))))
            subscriptions.push(tab.sessionChanged$.subscribe(()=>{if(tab.session!==session)finish(new Error('Terminal session changed before the command completed'))}))
            combined.addEventListener('abort',abort,{once:true})
            if(combined.aborted){abort();return}
            // Use Tabby's negotiated paste capability rather than assuming a Unix shell.
            const text=command.replace(/\r\n/g,'\n')
            const input=text.includes('\n')&&tab.frontend?.supportsBracketedPaste()
                ?`\x1b[200~${text}\x1b[201~`:text.replace(/\n/g,'\r')
            try{tab.sendInput(input+'\r');if(!settled)schedule()}catch(error){finish(error)}
        })
    } finally {running.delete(tab)}
}
