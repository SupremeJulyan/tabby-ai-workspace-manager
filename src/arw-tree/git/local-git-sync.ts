import { t } from '../../shared/i18n'
import { localGitRunner, LocalGitRunner } from './local-git-push'

export type LocalGitSyncAction = 'fetch'|'pull'|'push'

export async function syncLocalGit(root:string,action:LocalGitSyncAction,signal?:AbortSignal,runner:LocalGitRunner=localGitRunner()):Promise<void>{
    const run=(args:string[])=>runner(['-C',root,...args],signal)
    if(action==='fetch'){
        await run(['fetch','--prune'])
        return
    }
    let branch:string
    try{branch=(await run(['symbolic-ref','--quiet','--short','HEAD'])).trim()}
    catch(error){
        signal?.throwIfAborted()
        if(error instanceof Error&&/Local Git failed \(1\)|not a symbolic ref/i.test(error.message))throw new Error(t('当前为游离 HEAD，请先切换到本地分支。'))
        throw error
    }
    const tracking=(await run(['for-each-ref','--format=%(upstream:remotename)%00%(upstream:remoteref)',`refs/heads/${branch}`])).trim()
    const [remote,ref]=tracking.split('\0')
    if(!remote||!ref?.startsWith('refs/heads/'))throw new Error(t('当前分支未配置上游，请先在终端设置上游分支，再重试。'))
    if(action==='pull')await run(['pull','--ff-only','--no-rebase','--no-autostash','--',remote,ref])
    else await run(['push','--porcelain','--no-force','--no-mirror','--no-follow-tags','--recurse-submodules=no','--',remote,`HEAD:${ref}`])
}
