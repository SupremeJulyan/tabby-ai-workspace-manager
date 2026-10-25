import { t } from '../shared/i18n'
import type { SSHSession } from './ssh-compat'
import { TabbyRelayTransport } from './transport'
import { RemotePathGuard } from '../security/remote-path'
import { RemoteGit } from '../arw-tree/git/remote-git'
import { relayGit } from '../arw-tree/git/git-relay'
import { gitRelayLocks } from '../arw-tree/git/relay-locks'

/** Run the sidebar's local Git relay against an explicitly scoped remote repository. */
export function gitRelayOperation(session:SSHSession,workspaceRoot:string,storagePath:string) {
    return async(direction:'pull'|'push',path:string,signal:AbortSignal)=>{
        signal.throwIfAborted()
        if(!session.open)throw new Error(t('SSH 已断开'))
        const controller=new AbortController(),abort=()=>controller.abort()
        signal.addEventListener('abort',abort,{once:true})
        const closed=session.willDestroy$.subscribe(abort),timer=setTimeout(abort,600000)
        session.ref()
        let locked:string|undefined
        const locks=gitRelayLocks.get(session)??new Set<string>()
        gitRelayLocks.set(session,locks)
        try{
            const transport=new TabbyRelayTransport(session,workspaceRoot)
            const guard=new RemotePathGuard(workspaceRoot,(command,current)=>transport.run(command,current))
            const canonicalRoot=await guard.resolveDirectory('.',controller.signal)
            const directory=await guard.resolveDirectory(path,controller.signal)
            const candidate=new TabbyRelayTransport(session,directory)
            const git=new RemoteGit(command=>candidate.run(command,controller.signal))
            const root=(await git.run(['rev-parse','--show-toplevel'])).trim()
            const canonicalGuard=new RemotePathGuard(canonicalRoot,(command,current)=>transport.run(command,current))
            const repository=await canonicalGuard.resolveDirectory(root,controller.signal)
            if(locks.has(repository))throw new Error(t('此工作区已有 Git 中转任务'))
            locks.add(repository);locked=repository
            const result=await relayGit(direction,new TabbyRelayTransport(session,repository),{storagePath,signal:controller.signal})
            return {direction,workspaceRoot:repository,...result,status:result?.status??'pushed'}
        }finally{
            if(locked)locks.delete(locked)
            clearTimeout(timer);closed.unsubscribe();signal.removeEventListener('abort',abort);session.unref()
        }
    }
}
