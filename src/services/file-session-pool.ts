import type { Injector } from '@angular/core'
import type { AppService } from 'tabby-core'
import type { FileWorkspaceToken } from '../arw-tree/file-recovery'
import { isSshTab, type SSHSession } from '../adapters/ssh-compat'
import { logFileRecovery } from './file-recovery-log'

export class FileSessionPool {
    private connecting=new Map<string,Promise<SSHSession>>()
    private sessions=new Map<string,SSHSession>()
    private disposed=false
    constructor(private app:AppService,private injector:Injector){}

    async get(token:FileWorkspaceToken):Promise<SSHSession|undefined>{
        if(this.disposed)throw new Error('File connection pool is closed')
        const key=JSON.stringify([token.profileId,token.host,token.port??22,token.user])
        const cached=this.sessions.get(key)
        if(cached?.open)return cached
        const pending=this.connecting.get(key)
        if(pending)return pending
        for(const top of this.app.tabs??[]){
            const tabs='getAllTabs' in top?(top as any).getAllTabs():[top]
            for(const tab of tabs){
                if(!isSshTab(tab))continue
                const profile=tab.sshSession?.profile??tab.profile
                if(!profile||profile.options.host!==token.host||(profile.options.port??22)!==(token.port??22)
                    ||(token.profileId&&profile.id!==token.profileId))continue
                const user=tab.sshSession?.authUsername??profile.options.user
                if(user!==token.user)continue
                if(tab.sshSession?.open)return this.retain(key,tab.sshSession)
                if(tab.frontendIsReady||typeof tab.setupOneSession!=='function')continue
                const started=Date.now()
                logFileRecovery('pool-connect-start',{token})
                const operation=Promise.resolve().then(()=>tab.setupOneSession(this.injector,profile)).then(session=>{
                    if(!session.open||(session.authUsername??session.profile.options.user)!==token.user){
                        throw new Error('Recovered file session identity does not match')
                    }
                    logFileRecovery('pool-connect-ready',{token,elapsedMs:Date.now()-started})
                    return this.retain(key,session)
                }).catch(error=>{
                    logFileRecovery('pool-connect-error',{token,elapsedMs:Date.now()-started,error:String(error)})
                    throw error
                }).finally(()=>this.connecting.delete(key))
                this.connecting.set(key,operation)
                return operation
            }
        }
        return undefined
    }

    private retain(key:string,session:SSHSession):SSHSession{
        if(this.disposed){
            session.ref();session.unref()
            throw new Error('File connection pool is closed')
        }
        const previous=this.sessions.get(key)
        if(previous===session)return session
        session.ref()
        this.sessions.set(key,session)
        previous?.unref()
        return session
    }

    dispose():void{
        this.disposed=true
        for(const session of this.sessions.values())session.unref()
        this.sessions.clear()
    }
}
