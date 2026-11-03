import { isMsysTerminal } from './msys-directory'
import { isWslTerminal } from './wsl-directory'
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
    constructor(private marker:Buffer,private echoMarker:Buffer,private acknowledged:(status?:number)=>void) {}
    feedFromTerminal(data:Buffer):void {this.outputToSession$.next(data)}
    feedFromSession(data:Buffer):void {
        if(!this.active){this.outputToTerminal$.next(data);return}
        this.pending=Buffer.concat([this.pending,data])
        const index=this.pending.indexOf(this.marker)
        if(index<0)return
        const before=this.pending.subarray(0,index)
        const rest=this.pending.subarray(index+this.marker.length)
        // PTY output can split the status code and its delimiter across chunks.
        const status=/^(-?\d+)\x1f/.exec(rest.toString('latin1'))
        if(!status)return
        this.pending=Buffer.alloc(0);this.active=false
        // Remove only the echoed injected line. Keep output generated before cd.
        let visibleBefore=before
        const echoedAt=before.indexOf(this.echoMarker)
        if(echoedAt>=0){
            const start=before.lastIndexOf(0x0a,echoedAt)+1,end=before.indexOf(0x0a,echoedAt)
            if(end>=0)visibleBefore=Buffer.concat([before.subarray(0,start),before.subarray(end+1)])
        }
        const visibleAfter=rest.subarray(status[0].length)
        this.outputToTerminal$.next(Buffer.concat([Buffer.from('\r\x1b[2K'),visibleBefore,visibleAfter]))
        this.acknowledged(Number(status[1]))
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
    if(switching.has(session))throw new Error('A directory switch is already pending')
    switching.add(session)
    const nonce=randomBytes(16).toString('hex'),marker=Buffer.from(`\x1eARW_CD_${nonce}:`),echoMarker=Buffer.from(`ARW_CD_${nonce}`)
    let timer:ReturnType<typeof setTimeout>|undefined
    let closed:{unsubscribe():void}|undefined
    let changed:{unsubscribe():void}|undefined
    let filter:DirectoryEchoFilter|undefined
    try {
        await new Promise<void>((resolve,reject)=>{
            filter=new DirectoryEchoFilter(marker,echoMarker,status=>{
                if(status===undefined){reject(new Error(t('终端路径未同步，仍有未执行输入与任务')));return}
                if(status!==0){reject(new Error(t('终端路径未同步，仍有未执行输入与任务')));return}
                resolve()
            })
            session.middleware.push(filter as unknown as SessionMiddleware)
            closed=session.closed$.subscribe(()=>reject(new Error('Terminal closed during directory switch')))
            changed=tab.sessionChanged$.subscribe(()=>{if(tab.session!==session)reject(new Error('Terminal session changed'))})
            timer=setTimeout(()=>reject(new Error(t('终端路径未同步，仍有未执行输入与任务'))),3000)
            // The exit marker is emitted only after cd, with its actual status.
            const converter=isWslTerminal(tab)?'wslpath':isMsysTerminal(tab)?'cygpath':undefined
            const directory=converter&&/^(?:[a-z]:[\\/]|\\\\)/i.test(root)?`"$(${converter} -u ${shellQuote(root)})"`:shellQuote(root)
            tab.sendInput(` cd -- ${directory}; arw_status=$?; printf '\\036ARW_CD_${nonce}:%s\\037' "$arw_status"\r`)
        })
    } finally {
        if(timer)clearTimeout(timer)
        closed?.unsubscribe();changed?.unsubscribe()
        if(filter){filter.restore();session.middleware.remove(filter as unknown as SessionMiddleware);filter.close()}
        switching.delete(session)
    }
}
