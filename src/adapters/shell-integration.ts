import { t } from '../shared/i18n'
import { OPEN_WRITE, OPEN_CREATE, OPEN_TRUNCATE } from 'russh'
import { cwdIntegrationCommand, RemoteShell } from '../shared/shell-integration'
import { shellQuote } from '../shared/shell-quote'
import type { SSHSession } from './ssh-compat'
import { TabbyRelayTransport } from './transport'
import { optionalSftp } from './optional-sftp'

/** Stage integration off the interactive channel, which only needs one short source command. */
export async function prepareCwdIntegration (remote: SSHSession, shell: RemoteShell): Promise<{command:string;cleanup:()=>Promise<void>}> {
    const transport=new TabbyRelayTransport(remote,'.')
    const result=await transport.run('umask 077; mktemp -d "${TMPDIR:-/tmp}/tabby-ai-workspace-manager.XXXXXXXX"',AbortSignal.timeout(15000))
    const directory=result.stdout.replace(/\r?\n$/,'')
    if(result.exitCode!==0||!directory.startsWith('/')||directory.includes('\n')||directory.includes('\0'))throw new Error(result.stderr||t('无法建立远程集成脚本目录'))
    const script=`${directory}/${shell}.sh`
    const cleanup=async()=>{
        if(!remote.open)return
        await transport.run(`rm -f -- ${shellQuote(script)}; rmdir -- ${shellQuote(directory)}`,AbortSignal.timeout(5000)).catch(()=>undefined)
    }
    try{
        const sftp=await optionalSftp(remote)
        if(sftp){
            const file=await sftp.open(script,OPEN_WRITE|OPEN_CREATE|OPEN_TRUNCATE)
            try{await file.write(Buffer.from(cwdIntegrationCommand(shell)+'\n'))}finally{await file.close()}
            await sftp.chmod(script,0o600)
        }else{
            const result=await transport.run(`umask 077; printf '%s' ${shellQuote(cwdIntegrationCommand(shell)+'\n')} > ${shellQuote(script)} && chmod 600 ${shellQuote(script)}`,AbortSignal.timeout(15000))
            if(result.exitCode!==0)throw new Error(result.stderr||t('无法通过 SSH 写入目录检测脚本'))
        }
        return {command:`${shell==='fish'?'source':'.'} ${shellQuote(script)}`,cleanup}
    }catch(error){await cleanup();throw error}
}
