import { t } from '../shared/i18n'

export interface SaveIssue { message:string; busy:boolean }
interface SaveAttempt {
    content:string
    permissions?:string
    busy:boolean
    message:string
    started:boolean
}
type Disconnect = (listener:()=>void)=>{unsubscribe():void}

export class SaveConfirmationState {
    attempts=new Map<string,SaveAttempt>()
}

export class SaveConfirmation {
    constructor(private disconnected:Disconnect,private connected:()=>boolean,private timeoutMs=30000,private state=new SaveConfirmationState()) {}
    private get attempts():Map<string,SaveAttempt> {return this.state.attempts}

    issue(path:string):SaveIssue|undefined {
        const attempt=this.attempts.get(path)
        return attempt?.message ? {message:attempt.message,busy:attempt.busy} : undefined
    }

    async run<Result>(path:string,content:string,write:(signal:AbortSignal,permissions:(value:string)=>void,started:()=>void)=>Promise<Result>,confirmedRetry=false):Promise<Result> {
        const previous=this.attempts.get(path)
        if(previous&&(!confirmedRetry||previous.busy))throw new Error(t('上次保存尚未确认，请先核对或重新加载远端文件'))
        if(!this.connected())throw new Error(t('SSH 已断开'))
        const attempt:SaveAttempt={content,busy:true,message:previous?.message??'',started:false}
        this.attempts.set(path,attempt)
        const controller=new AbortController()
        let timer:ReturnType<typeof setTimeout>|undefined
        let subscription:ReturnType<Disconnect>|undefined
        const cancelled=new Promise<never>((_resolve,reject)=>{
            const fail=(reason:string)=>{
                attempt.message=reason
                controller.abort(new Error(reason))
                reject(controller.signal.reason)
            }
            timer=setTimeout(()=>fail(t('保存超时，保存未确认，远端内容可能不完整')),this.timeoutMs)
            subscription=this.disconnected(()=>fail(t('连接已断开，保存未确认，远端内容可能不完整')))
            if(!this.connected())fail(t('连接已断开，保存未确认，远端内容可能不完整'))
        })
        const operation=Promise.resolve().then(()=>{
            controller.signal.throwIfAborted()
            return write(controller.signal,value=>{attempt.permissions=value},()=>{attempt.started=true})
        }).finally(()=>{attempt.busy=false})
        try {
            const result=await Promise.race([operation,cancelled])
            this.attempts.delete(path)
            return result
        } catch(error) {
            if(!attempt.started&&!controller.signal.aborted){
                if(previous)this.attempts.set(path,previous)
                else this.attempts.delete(path)
                throw error
            }
            attempt.message ||= t('保存失败，保存未确认，远端内容可能不完整')
            throw new Error(`${attempt.message}: ${String(error)}`,{cause:error})
        } finally {
            clearTimeout(timer)
            subscription?.unsubscribe()
        }
    }

    async verify(path:string,read:(signal:AbortSignal)=>Promise<{content:string;permissions:string}>):Promise<void> {
        const attempt=this.attempts.get(path)
        if(!attempt)return
        if(attempt.busy)throw new Error(t('上次写入仍未结束，暂不能核对或再次保存'))
        if(attempt.permissions===undefined)throw new Error(t('缺少保存前的权限记录，请重新加载远端文件'))
        const controller=new AbortController()
        let timer:ReturnType<typeof setTimeout>|undefined
        try {
            const timeout=new Promise<never>((_resolve,reject)=>{
                timer=setTimeout(()=>{controller.abort();reject(new Error(t('核对超时，异常标记保留')))},this.timeoutMs)
            })
            const current=await Promise.race([read(controller.signal),timeout])
            if(current.content!==attempt.content||current.permissions!==attempt.permissions)throw new Error(t('远端内容或权限不一致，异常标记保留'))
            if(this.attempts.get(path)===attempt)this.attempts.delete(path)
        } finally {clearTimeout(timer)}
    }

    async reload<Result>(path:string,read:(signal:AbortSignal)=>Promise<Result>):Promise<Result> {
        const attempt=this.attempts.get(path)
        if(attempt?.busy)throw new Error(t('上次写入仍未结束，暂不能核对或再次保存'))
        const controller=new AbortController()
        let timer:ReturnType<typeof setTimeout>|undefined
        try {
            const timeout=new Promise<never>((_resolve,reject)=>{
                timer=setTimeout(()=>{controller.abort();reject(new Error(t('核对超时，异常标记保留')))},this.timeoutMs)
            })
            const result=await Promise.race([read(controller.signal),timeout])
            if(this.attempts.get(path)===attempt)this.attempts.delete(path)
            return result
        } finally {clearTimeout(timer)}
    }
}
