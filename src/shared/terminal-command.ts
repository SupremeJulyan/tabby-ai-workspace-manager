import { randomBytes } from 'node:crypto'
import { shellQuote } from './shell-quote'
import type { BaseTerminalTabComponent } from 'tabby-terminal'
import type { GitResult } from '../arw-tree/git/remote-git'

const modes=new WeakMap<object,{enabled:boolean;controller:AbortController}>()
const running=new WeakSet<object>()
export function setTerminalCommandMode(tab:object,enabled:boolean):void {
    modes.get(tab)?.controller.abort(new Error('Terminal mode stopped'))
    modes.set(tab,{enabled,controller:new AbortController()})
}
export function isTerminalCommandMode(tab:object):boolean {return modes.get(tab)?.enabled??false}

/** Inject into the existing PTY; never open a separate SSH exec channel. */
export async function runTerminalCommand(tab:BaseTerminalTabComponent<any>,root:string,command:string,signal:AbortSignal,maxBytes=8*1024*1024):Promise<GitResult> {
    const mode=modes.get(tab),session=tab.session
    if(!mode?.enabled)throw new Error('Terminal mode is not enabled')
    if(!session?.open||tab.alternateScreenActive)throw new Error('Return to the connected shell prompt before running a command')
    if(running.has(tab))throw new Error('Another Agent command is already running in this terminal')
    const combined=AbortSignal.any([signal,mode.controller.signal,AbortSignal.timeout(120000)])
    combined.throwIfAborted()
    running.add(tab)
    try {
        const cwd=await session.getWorkingDirectory()
        combined.throwIfAborted()
        if(cwd!==root)throw new Error('Terminal directory changed. Follow its current directory and reopen the AI terminal')
        if(tab.session!==session)throw new Error('Terminal session changed')
        const nonce=randomBytes(16).toString('hex'),start=`\x1eARW_${nonce}_START\x1f`,end=`\x1eARW_${nonce}_END:`
        // The subshell inherits the terminal user, cwd and exported environment.
        // It also keeps command-local cd/exit from changing or closing the shell.
        const script=`printf '\\036ARW_${nonce}_START\\037'; (\n`+
            `[ "$(pwd -P)" = "$(cd -- ${shellQuote(root)} && pwd -P)" ] || { printf '%s\\n' 'Terminal directory changed'; exit 125; }\n`+
            `${command}\n); arw_status=$?; printf '\\036ARW_${nonce}_END:%s\\037' "$arw_status"`
        return await new Promise<GitResult>((resolve,reject)=>{
            let buffer='',started=false,settled=false
            const subscriptions:Array<{unsubscribe():void}>=[]
            const finish=(error?:unknown,result?:GitResult)=>{
                if(settled)return
                settled=true;combined.removeEventListener('abort',abort)
                for(const subscription of subscriptions)subscription.unsubscribe()
                if(error)reject(error);else resolve(result!)
            }
            const interrupt=()=>{if(tab.session===session&&session.open)tab.sendInput('\x03')}
            const abort=()=>{try{interrupt()}finally{finish(combined.reason??new Error('Terminal command canceled'))}}
            subscriptions.push(session.output$.subscribe(chunk=>{
                if(settled)return
                buffer+=chunk
                if(!started){const index=buffer.indexOf(start);if(index<0){buffer=buffer.slice(-start.length);return}buffer=buffer.slice(index+start.length);started=true}
                const index=buffer.indexOf(end)
                if(index>=0){const match=/^(-?\d+)\x1f/.exec(buffer.slice(index+end.length));if(match){if(Buffer.byteLength(buffer.slice(0,index))>maxBytes){finish(new Error('Terminal command output exceeded the capture limit'));return}finish(undefined,{stdout:buffer.slice(0,index).replace(/\r\n/g,'\n'),stderr:'',exitCode:Number(match[1])});return}}
                if(Buffer.byteLength(buffer)>maxBytes+end.length+32){try{interrupt()}finally{finish(new Error('Terminal command output exceeded the capture limit'))}}
            }))
            subscriptions.push(session.closed$.subscribe(()=>finish(new Error('Terminal closed before the command completed'))))
            subscriptions.push(tab.sessionChanged$.subscribe(()=>{if(tab.session!==session)finish(new Error('Terminal session changed before the command completed'))}))
            combined.addEventListener('abort',abort,{once:true})
            if(combined.aborted){abort();return}
            try{tab.sendInput(` sh -c ${shellQuote(script)}\r`)}catch(error){finish(error)}
        })
    } finally {running.delete(tab)}
}
