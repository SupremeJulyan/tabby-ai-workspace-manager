import { OPEN_READ, OPEN_WRITE, OPEN_CREATE, OPEN_TRUNCATE } from 'russh'
import type { SFTPSession, SFTPFile } from 'tabby-ssh/typings/session/sftp'
import { textFileLimit, WorkspaceText } from '../arw-tree/workspace'
import { t } from '../shared/i18n'
import { decodeText } from '../shared/decode-text'
import { FileConflictError } from '../shared/file-conflict'
import { readSftpBytes } from './sftp-read'

// SFTP v3 SSH_FXF_EXCL; russh exports the other OPEN flags only.
const OPEN_EXCLUSIVE=32

export const sftpPermissions = (info:SFTPFile):string|undefined =>
    // Compare ordinary permissions and sticky bit; leave setuid/setgid to the server.
    Number.isInteger(info.mode)&&info.mode>=0 ? (info.mode&0o1777).toString(8) : undefined

export function sftpTextVersion(info:SFTPFile):string {
    const modified=info.modified?.getTime()
    if(!Number.isSafeInteger(info.size)||info.size<0||!Number.isFinite(modified))
        throw new Error(t('无法读取远端文件的修改时间或大小'))
    return `sftp:${info.size}:${modified}`
}

export async function readSftpText(sftp:SFTPSession,target:string,signal?:AbortSignal,info?:SFTPFile):Promise<WorkspaceText> {
    signal?.throwIfAborted()
    info ??= await sftp.stat(target)
    if(info.isDirectory)throw new Error(t('只能读取普通文本文件'))
    if(!Number.isSafeInteger(info.size)||info.size<0||info.size>textFileLimit)throw new Error(t('文本文件上限为 500 MiB'))
    const version=sftpTextVersion(info)
    signal?.throwIfAborted()
    const file=await sftp.open(target,OPEN_READ)
    try {
        const bytes=await readSftpBytes(file,info.size,signal)
        if(bytes.includes(0))throw new Error(t('暂不支持二进制文件'))
        const content=decodeText(bytes)
        return {content,hash:version}
    }finally{await file.close()}
}

/** In-place SFTP writes retain the existing inode, owner, ACLs and ordinary mode bits. */
export async function saveSftpText(
    sftp:SFTPSession,target:string,content:string,expectedVersion:string|undefined,
    signal:AbortSignal,recordPermissions:(permissions:string)=>void,started:()=>void,
):Promise<string> {
    signal.throwIfAborted()
    let before:SFTPFile|undefined
    try{before=await sftp.stat(target)}catch(error){
        if(!/no such file|not found|ENOENT/i.test(String(error)))throw error
    }
    signal.throwIfAborted()
    if(before?.isDirectory)throw new Error(t('只能保存普通文件'))
    if(expectedVersion!==undefined){
        if(!before||sftpTextVersion(before)!==expectedVersion)
            throw new FileConflictError(t('远端文件已变化'))
    }
    const mode=before?sftpPermissions(before):'600'
    if(mode!==undefined)recordPermissions(mode)
    // Keep encoding memory bounded even for a 500 MiB editor buffer.
    const bytes=Buffer.allocUnsafe(Math.min(256*1024,content.length*3)),encoder=new TextEncoder()
    let writtenBytes=0
    signal.throwIfAborted()
    // OPEN can truncate before a lost response reaches us; mark the attempt first.
    started()
    const file=await sftp.open(target,OPEN_WRITE|(before?OPEN_TRUNCATE:OPEN_CREATE|OPEN_EXCLUSIVE))
    try{
        signal.throwIfAborted()
        // Set new-file permissions before writing any data. Never chmod ordinary existing files.
        if(!before)await sftp.chmod(target,0o600)
        for(let offset=0;offset<content.length;){
            signal.throwIfAborted()
            // One extra UTF-16 code unit prevents the source slice from cutting a surrogate pair
            // that could fit in this chunk. encodeInto never splits a UTF-8 sequence.
            const {read,written}=encoder.encodeInto(content.slice(offset,offset+bytes.length+1),bytes)
            await file.write(bytes.subarray(0,written))
            offset+=read;writtenBytes+=written
        }
        signal.throwIfAborted()
    }finally{await file.close()}
    signal.throwIfAborted()
    const after=await sftp.stat(target)
    signal.throwIfAborted()
    if(after.size!==writtenBytes)throw new Error(t('远程文件在保存时发生变化'))
    if(mode!==undefined&&sftpPermissions(after)!==mode)throw new Error(t('远端文件权限在保存时发生了变化'))
    return sftpTextVersion(after)
}
