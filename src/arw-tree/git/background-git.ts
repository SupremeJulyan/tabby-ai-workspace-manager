import { t } from '../../shared/i18n'
import type { Workspace } from '../workspace'
import { gitCommand } from './remote-git'

/** Bound read-only background work independently of whether the backend honours cancellation. */
export async function readBackgroundGit(workspace:Workspace,command:string|string[],parent?:AbortSignal,timeoutMs=3000) {
    parent?.throwIfAborted()
    const controller=new AbortController()
    const abort=()=>controller.abort(parent?.reason)
    parent?.addEventListener('abort',abort,{once:true})
    const timer=setTimeout(()=>controller.abort(new Error(t('Git 自动更新超时，请进入具体项目后刷新。'))),timeoutMs)
    let cancelled:()=>void=()=>{}
    const stopped=new Promise<never>((_resolve,reject)=>{
        cancelled=()=>reject(controller.signal.reason)
        controller.signal.addEventListener('abort',cancelled,{once:true})
    })
    try {
        const options={maxBytes:256*1024}
        const result=Array.isArray(command)&&workspace.runGit
            ?workspace.runGit(command,controller.signal,options)
            :workspace.run(Array.isArray(command)?gitCommand(command):command,controller.signal,options)
        return await Promise.race([result,stopped])
    } finally {
        clearTimeout(timer)
        parent?.removeEventListener('abort',abort)
        controller.signal.removeEventListener('abort',cancelled)
    }
}
