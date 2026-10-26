import { t } from '../shared/i18n'
import { previewLimit } from '../shared/read-bytes'
import { posix } from 'path'
import { randomUUID } from 'crypto'
import { OPEN_READ } from 'russh'
import { Workspace } from '../arw-tree/workspace'
import type { SSHSession } from './ssh-compat'
import { TabbyRelayTransport } from './transport'
import { RemotePathGuard } from '../security/remote-path'
import { commandBoundaryTargets } from '../security/command-policy'
import { optionalSftp } from './optional-sftp'
import { listShellDirectory, readShellText, parseShellDirectory } from './shell-files'
import { notifyWorkspaceChange } from '../shared/workspace-changes'
import { textFileLimit } from '../arw-tree/workspace'
import { executeChannel } from '../shared/exec-channel'
import { shellQuote } from '../shared/shell-quote'
import { SaveConfirmation, SaveConfirmationState } from './save-confirmation'
import { leafName } from '../shared/workspace-name'
import { saveRemoteText } from './remote-save'
import { readSftpText, saveSftpText, sftpPermissions } from './sftp-text'

class BackgroundDirectoryLimit extends Error {}

const workspaceSessions = new WeakMap<Workspace, SSHSession>()
const saveConfirmations=new WeakMap<SSHSession,SaveConfirmation>()
const profileSaveStates=new Map<string,SaveConfirmationState>()
export const remoteWorkspaceSession = (workspace: Workspace): SSHSession|undefined => workspaceSessions.get(workspace.sourceWorkspace ?? workspace)
interface WritePriority { active:number; waiters:Set<()=>void> }
const writePriorities=new WeakMap<SSHSession,WritePriority>()
const writePriority=(session:SSHSession)=>{
    let priority=writePriorities.get(session)
    if(!priority){priority={active:0,waiters:new Set()};writePriorities.set(session,priority)}
    return priority
}
const waitForForegroundWrites=(priority:WritePriority,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(priority.active===0){resolve();return}
    const done=()=>{signal.removeEventListener('abort',abort);priority.waiters.delete(done);resolve()}
    const abort=()=>{priority.waiters.delete(done);reject(signal.reason??new Error(t('操作已取消')))}
    priority.waiters.add(done)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
})
const finishForegroundWrite=(priority:WritePriority)=>{
    priority.active--
    if(priority.active===0)for(const done of [...priority.waiters])done()
}

export function remoteWorkspace (session: SSHSession, root: string): Workspace {
    const transport = new TabbyRelayTransport(session, root)
    const guard = new RemotePathGuard(root, (command, signal) => transport.run(command, signal))
    const priority=writePriority(session)
    let confirmations=saveConfirmations.get(session)
    if(!confirmations){
        const profile=session.profile
        const key=profile.id?JSON.stringify([profile.id,profile.options.host,profile.options.port,session.authUsername??profile.options.user]):undefined
        const state=key?profileSaveStates.get(key)??new SaveConfirmationState():new SaveConfirmationState()
        if(key)profileSaveStates.set(key,state)
        confirmations=new SaveConfirmation(listener=>session.willDestroy$?.subscribe(listener)??{unsubscribe(){}},()=>session.open,30000,state)
        saveConfirmations.set(session,confirmations)
    }
    const saves=confirmations
    const saveKey=(input:string)=>posix.resolve(root,input)
    const permissions=(metadata:string)=>{
        const [mode,uid,gid]=metadata.split(':').slice(3,6)
        return `${(parseInt(mode,8)&0o1777).toString(8)}:${uid}:${gid}`
    }
    const read = async (input: string,signal?:AbortSignal) => {
        signal?.throwIfAborted()
        if (!session.open) throw new Error(t('SSH 已断开'))
        const sftp = await optionalSftp(session)
        signal?.throwIfAborted()
        if (sftp) return readSftpText(sftp,posix.resolve(root,input),signal)
        const target = await guard.resolveRead(input,signal)
        return readShellText(transport, target,signal)
    }
    const workspace: Workspace = {
        id: randomUUID(), kind: 'remote', root, host: session.profile.options.host, name: leafName(root), titleName: leafName(root),
        label: `${session.authUsername ?? session.profile.options.user ?? ''}@${session.profile.options.host}:${root}`,
        async watchSnapshot(directories, changed, signal) {
            const sftp = await optionalSftp(session)
            const watched=new Map<string,string>()
            const snapshot=async(input:string)=>{
                signal.throwIfAborted()
                await waitForForegroundWrites(priority,signal)
                const target = sftp?posix.resolve(root,input):await guard.resolveRead(input, signal)
                await waitForForegroundWrites(priority,signal)
                if(sftp){
                    const entries=await sftp.readdir(target)
                    if(entries.length>2000)throw new BackgroundDirectoryLimit(t('目录条目超过 2000，已停止后台目录检测。'))
                    return entries.map(entry=>`${entry.name}\0${entry.isDirectory}\0${entry.isSymlink}\0${entry.size}\0${entry.modified instanceof Date?entry.modified.getTime():String(entry.modified)}`).sort().join('\0')
                }
                if (!session.open || !('openSessionChannel' in session.ssh)) throw new Error(t('SSH 已断开'))
                const channel = await session.ssh.activateChannel(await session.ssh.openSessionChannel())
                const closed = session.willDestroy$.subscribe(() => { void channel.close().catch(() => undefined) })
                try{
                    const result=await executeChannel(channel,`find -- ${shellQuote(target)} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0%l\\0%s\\0%T@\\0'`,root,{signal,maxBytes:512*1024,timeoutMs:3000})
                    if(result.truncated)throw new BackgroundDirectoryLimit(t('目录过大，已停止后台目录检测。'))
                    if(result.exitCode!==0)throw new Error(result.stderr.trim()||t('无法读取远程目录状态'))
                    const entries:string[]=[],fields=result.stdout.split('\0')
                    for(let index=0;index+4<fields.length;index+=5)entries.push(fields.slice(index,index+5).join('\0'))
                    if(entries.length>2000)throw new BackgroundDirectoryLimit(t('目录条目超过 2000，已停止后台目录检测。'))
                    return entries.sort().join('\0')
                }finally{closed.unsubscribe()}
            }
            const poll=async(initial=false)=>{
                signal.throwIfAborted()
                await waitForForegroundWrites(priority,signal)
                const inputs=[...new Set(directories())].slice(0,32)
                if(!inputs.length)throw new Error(t('没有可检测的远程目录'))
                const changedInputs:string[]=[]
                for(const input of inputs){
                    try{
                        const current=await snapshot(input)
                        const previous=watched.get(input)
                        watched.set(input,current)
                        if(!initial&&previous!==undefined&&previous!==current)changedInputs.push(input)
                    }catch(error){
                        if(signal.aborted||error instanceof BackgroundDirectoryLimit)throw error
                        if(watched.has(input)){
                            watched.delete(input)
                            if(!initial)changedInputs.push(input)
                        }else if(initial&&input===inputs[0])throw error
                    }
                }
                for(const input of [...watched.keys()])if(!inputs.includes(input))watched.delete(input)
                if(changedInputs.length)changed([...new Set(changedInputs)])
            }
            await poll(true)
            while(!signal.aborted){
                await new Promise<void>(resolve=>{
                    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},5000)
                    const abort=()=>{clearTimeout(timer);resolve()}
                    signal.addEventListener('abort',abort,{once:true})
                })
                if(signal.aborted)break
                try{
                    await poll()
                }catch(error){if(!signal.aborted)throw error}
            }
        },
        async listForGit(input,limit,signal) {
            signal?.throwIfAborted()
            const target=await guard.resolveRead(input,signal??AbortSignal.timeout(3000))
            // Stream only a bounded prefix; SFTP readdir materializes the entire directory.
            const result=await transport.run(`cd -- ${shellQuote(target)} || exit $?
printf 'ARW_DIRECTORY_V1\\000'
find . -mindepth 1 -maxdepth 1 \\( -type d -o -type f -o -type l \\) -printf '%y\\000%f\\000' | head -z -n ${2*(limit+1)}`,signal??AbortSignal.timeout(3000),{maxBytes:512*1024})
            signal?.throwIfAborted()
            if(result.exitCode!==0||result.truncated||result.stderr.trim())throw new Error(result.stderr.trim()||t('无法通过 SSH 读取远程目录'))
            const entries=parseShellDirectory(result.stdout,input)
            return {entries:entries.slice(0,limit),truncated:entries.length>limit}
        },
        async list(input, signal) {
            signal?.throwIfAborted()
            if (!session.open) throw new Error(t('SSH 已断开'))
            const sftp = await optionalSftp(session)
            if(!sftp)return listShellDirectory(transport,await guard.resolveRead(input,signal??AbortSignal.timeout(30000)),input,signal)
            signal?.throwIfAborted()
            const files=await sftp.readdir(posix.resolve(root,input))
            signal?.throwIfAborted()
            return files.filter(file => !['.', '..'].includes(file.name))
                .map(file => ({ name: file.name, path: posix.join(input, file.name), directory: file.isDirectory, symlink: file.isSymlink }))
                .sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name))
        },
        read,
        saveIssue:input=>saves.issue(saveKey(input)),
        async verifySave(input){
            let file:Awaited<ReturnType<typeof read>>|undefined
            await saves.verify(saveKey(input),async signal=>{
                const sftp=await optionalSftp(session)
                if(sftp){
                    const target=posix.resolve(root,input),before=await sftp.stat(target)
                    file=await readSftpText(sftp,target,signal,before)
                    const after=await sftp.stat(target)
                    const mode=sftpPermissions(after)
                    if(before.size!==after.size||sftpPermissions(before)!==mode||mode===undefined)
                        throw new Error(t('远端内容或权限不一致，异常标记保留'))
                    return {content:file.content,permissions:mode}
                }
                const target=await guard.resolve(input,false,signal)
                const before=await guard.metadata(target,signal)
                file=await read(input,signal)
                const after=await guard.metadata(target,signal)
                if(before!==after)throw new Error(t('远端内容或权限不一致，异常标记保留'))
                return {content:file.content,permissions:permissions(after)}
            })
            notifyWorkspaceChange(workspace)
            return file??await read(input)
        },
        async reloadSave(input){
            const file=await saves.reload(saveKey(input),signal=>read(input,signal))
            notifyWorkspaceChange(workspace)
            return file
        },
        async readBytes(input,maxBytes,signal){
            previewLimit(maxBytes);signal?.throwIfAborted()
            if(!session.open)throw new Error(t('SSH 已断开'))
            const sftp=await optionalSftp(session)
            if(!sftp)throw new Error(t('当前 SSH 会话不支持 SFTP 二进制预览'))
            const target=posix.resolve(root,input),info=await sftp.stat(target)
            if(info.isDirectory)throw new Error(t('只能预览普通文件'))
            if(!Number.isSafeInteger(info.size)||info.size<0||info.size>maxBytes)throw new Error(t`预览上限为 ${Math.floor(maxBytes/1024/1024)} MiB`)
            const file=await sftp.open(target,OPEN_READ)
            try{
                const chunks:Buffer[]=[];let length=0
                while(true){
                    signal?.throwIfAborted();const bytes=await file.read();signal?.throwIfAborted()
                    if(!bytes.length)break
                    length+=bytes.length;if(length>maxBytes)throw new Error(t('文件超过预览大小限制'))
                    chunks.push(Buffer.from(bytes))
                }
                if(length!==info.size)throw new Error(t('远程文件在读取时发生变化，请重新打开'))
                return Buffer.concat(chunks)
            }finally{await file.close()}
        },
        write,
        retrySave:(input,content)=>write(input,content,undefined,true),
        run: (command, signal, options) => transport.run(command, signal, options),
        async validateCommand(command, signal) {
            await guard.resolve('.', false, signal)
            for (const target of commandBoundaryTargets(command, root)) {
                await guard.resolve(target.target, target.kind === 'write-target', signal)
            }
        },
    }
    async function write(input:string, content:string, expectedHash?:string,confirmedRetry=false) {
            if (Buffer.byteLength(content) > textFileLimit) throw new Error(t('文本文件上限为 500 MiB'))
            return saves.run(saveKey(input),content,async(signal,recordPermissions,started)=>{
              priority.active++
              try {
                const connection=session.ssh
                const check=()=>{
                    signal.throwIfAborted()
                    if(!session.open||session.ssh!==connection)throw new Error(t('SSH 会话已断开或重连，请刷新目录'))
                }
                check()
                const sftp=await optionalSftp(session)
                check()
                const version=sftp
                    ?await saveSftpText(sftp,posix.resolve(root,input),content,expectedHash,signal,recordPermissions,started)
                    :await saveRemoteText(transport,root,input,content,expectedHash,signal,recordPermissions,started)
                check()
                notifyWorkspaceChange(workspace)
                return { content, hash: version }
              } finally { finishForegroundWrite(priority) }
            },confirmedRetry)
    }
    workspaceSessions.set(workspace, session)
    return workspace
}
