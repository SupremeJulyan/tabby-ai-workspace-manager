import type { SFTPFileHandle } from 'tabby-ssh/typings/session/sftp'
import { t } from '../shared/i18n'

/** Fill one owned buffer instead of retaining every chunk and copying them again at EOF. */
export async function readSftpBytes(file:Pick<SFTPFileHandle,'read'>,size:number,signal?:AbortSignal):Promise<Buffer> {
    signal?.throwIfAborted()
    const result=Buffer.allocUnsafe(size)
    let offset=0
    while(true){
        signal?.throwIfAborted()
        const chunk=await file.read()
        signal?.throwIfAborted()
        if(!chunk.length)break
        if(chunk.length>size-offset)throw new Error(t('远程文件在读取时发生变化，请重新打开'))
        result.set(chunk,offset)
        offset+=chunk.length
    }
    // Read through EOF even when the advertised size is reached, detecting growth too.
    if(offset!==size)throw new Error(t('远程文件在读取时发生变化，请重新打开'))
    return result
}
