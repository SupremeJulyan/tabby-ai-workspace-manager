import { randomBytes } from 'node:crypto'
import { Subject } from 'rxjs'
import type { BaseTerminalTabComponent, SessionMiddleware } from 'tabby-terminal'
import { shellQuote } from './shell-quote'
import { t } from './i18n'

/** Hide only the injected command, until the shell acknowledges executing it. */
export class DirectoryEchoFilter {
    readonly outputToSession$ = new Subject<Buffer>()
    readonly outputToTerminal$ = new Subject<Buffer>()
    private pending = Buffer.alloc(0)
    private active = true
    constructor(private marker:Buffer,private acknowledged:()=>void) {}
    feedFromTerminal(data:Buffer):void {this.outputToSession$.next(data)}
    feedFromSession(data:Buffer):void {
        if(!this.active){this.outputToTerminal$.next(data);return}
        this.pending=Buffer.concat([this.pending,data])
        const index=this.pending.indexOf(this.marker)
        if(index<0)return
        const rest=this.pending.subarray(index+this.marker.length)
        this.pending=Buffer.alloc(0);this.active=false
        // Replace the old prompt; the shell will print its new directory prompt.
        this.outputToTerminal$.next(Buffer.concat([Buffer.from('\r\x1b[2K'),rest]))
        this.acknowledged()
    }
    restore():void {
        this.active=false
        if(this.pending.length)this.outputToTerminal$.next(this.pending)
        this.pending=Buffer.alloc(0)
    }
    close():void {this.outputToSession$.complete();this.outputToTerminal$.complete()}
}

const switching=new WeakSet<object>()
export async function changeTerminalDirectory(tab:BaseTerminalTabComponent<any>,root:string):Promise<void> {
    const session=tab.session
    if(!session?.open)throw new Error(t('终端尚未连接，无法切换目录'))
    if(tab.alternateScreenActive)throw new Error(t('终端正在运行全屏程序，请先退出到 shell 提示符再切换目录'))
    if(switching.has(session))throw new Error('A directory switch is already pending')
    switching.add(session)
    const nonce=randomBytes(16).toString('hex'),marker=Buffer.from(`\x1eARW_CD_${nonce}\x1f`)
    let timer:ReturnType<typeof setTimeout>|undefined
    let closed:{unsubscribe():void}|undefined
    let changed:{unsubscribe():void}|undefined
    let filter:DirectoryEchoFilter|undefined
    try {
        await new Promise<void>((resolve,reject)=>{
            filter=new DirectoryEchoFilter(marker,resolve)
            session.middleware.push(filter as unknown as SessionMiddleware)
            closed=session.closed$.subscribe(()=>reject(new Error('Terminal closed during directory switch')))
            changed=tab.sessionChanged$.subscribe(()=>{if(tab.session!==session)reject(new Error('Terminal session changed'))})
            timer=setTimeout(()=>reject(new Error('The shell did not acknowledge the directory switch')),3000)
            // Escapes keep the marker out of the echoed command itself. cd runs in
            // the interactive shell, so its cwd and environment remain in effect.
            tab.sendInput(` printf '\\036ARW_CD_${nonce}\\037'; cd -- ${shellQuote(root)}\r`)
        })
    } finally {
        if(timer)clearTimeout(timer)
        closed?.unsubscribe();changed?.unsubscribe()
        if(filter){filter.restore();session.middleware.remove(filter as unknown as SessionMiddleware);filter.close()}
        switching.delete(session)
    }
}
