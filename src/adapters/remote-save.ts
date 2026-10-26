import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import { shellQuote } from '../shared/shell-quote'
import { isRemotePathInsideRoot, RemotePathError } from '../security/remote-path'
import type { TabbyRelayTransport } from './transport'
import { FileConflictError } from '../shared/file-conflict'

export async function saveRemoteText(
    transport:TabbyRelayTransport,root:string,input:string,content:string,expectedVersion:string|undefined,
    signal:AbortSignal,recordPermissions:(permissions:string)=>void,started:()=>void,
):Promise<string> {
    if(!posix.isAbsolute(root)||/[\x00-\x1f\x7f]/.test(root+input))throw new RemotePathError('Invalid remote path')
    const target=posix.resolve(root,input)
    if(!isRemotePathInsideRoot(root,target))throw new RemotePathError('Path is outside workspaceRoot')
    if(expectedVersion!==undefined&&!/^shell:\d+:[^\x00-\x1f\x7f]{1,128}$/.test(expectedVersion))throw new FileConflictError('Remote file has changed (远端文件已变化)')
    const quoted=shellQuote(target),marker=`ARW_SAVE_${randomBytes(24).toString('hex')}`
    const ready=`\0${marker}:READY\0`,begin=`\0${marker}:STARTED\0`,bytes=Buffer.from(content)
    let acknowledged=false
    const result=await transport.run(`test ! -L ${quoted} || { printf '%s\\n' 'symbolic-link writes are not allowed' >&2; exit 1; }
_arw_root=$(realpath -e -- ${shellQuote(root)}) && _arw_target=$(realpath -m -- ${quoted}) || exit 1
case "$_arw_target" in "$_arw_root"|"\${_arw_root%/}"/*) ;; *) printf '%s\\n' 'Path escapes workspaceRoot through a symbolic link' >&2; exit 1 ;; esac
_arw_stat() { test ! -L ${quoted} && test -f ${quoted} && stat -c '%d:%i:%h:%a:%u:%g:%s:%y:%z' -- ${quoted}; }
_arw_before=''
_arw_mode='600'
if test -e ${quoted}; then
    _arw_before=$(_arw_stat) || exit 1
    IFS=: read -r _arw_dev _arw_ino _arw_links _arw_mode _arw_uid _arw_gid _arw_rest <<ARW_METADATA
$_arw_before
ARW_METADATA
    test "$_arw_links" = 1 || { printf '%s\\n' 'Cannot safely write a hard-linked file' >&2; exit 1; }
    ${expectedVersion===undefined?'':`test "$(stat -c '%s:%y' -- ${quoted})" = ${shellQuote(expectedVersion.slice('shell:'.length))} || { printf '%s\\n' 'Remote file has changed (远端文件已变化)' >&2; exit 1; }`}
    test "$(_arw_stat)" = "$_arw_before" || { printf '%s\\n' 'Remote file changed before saving (远端文件在保存前发生了变化)' >&2; exit 1; }
else
    ${expectedVersion===undefined?':':`printf '%s\\n' 'Remote file has changed (远端文件已变化)' >&2; exit 1`}
fi
printf '\\000${marker}:PERMISSIONS:%s\\000' "$_arw_mode:\${_arw_uid-}:\${_arw_gid-}"
printf '\\000${marker}:STARTED\\000'
if test -n "$_arw_before"; then
    exec 3> ${quoted} || exit 1
else
    umask 077
    set -C
    exec 3> ${quoted} || exit 1
    _arw_new=$(_arw_stat) || exit 1
    IFS=: read -r _arw_dev _arw_ino _arw_links _arw_mode _arw_uid _arw_gid _arw_rest <<ARW_METADATA
$_arw_new
ARW_METADATA
    printf '\\000${marker}:PERMISSIONS:%s\\000' "$_arw_mode:$_arw_uid:$_arw_gid"
fi
printf '\\000${marker}:READY\\000'
cat >&3 || exit 1
exec 3>&-
test "$(wc -c < ${quoted})" -eq ${bytes.length} || { printf '%s\\n' 'Remote file changed during save (远程文件在读取时发生变化)' >&2; exit 1; }
_arw_version=$(stat -c '%s:%y' -- ${quoted}) || exit 1
printf '\\000${marker}:VERSION:%s\\000' "$_arw_version"`,signal,{
        input:bytes,inputReadyMarker:ready,maxBytes:16384,
        onStdout:output=>{
            const records=output.split(`\0${marker}:PERMISSIONS:`).slice(1)
            for(const record of records){
                const end=record.indexOf('\0')
                if(end<0)continue
                const permissions=record.slice(0,end)
                if(/^[0-7]+:\d+:\d+$/.test(permissions)){
                    const [mode,uid,gid]=permissions.split(':')
                    recordPermissions(`${(parseInt(mode,8)&0o1777).toString(8)}:${uid}:${gid}`)
                }
            }
            if(!acknowledged&&output.includes(begin)){acknowledged=true;started()}
        },
    })
    signal.throwIfAborted()
    if(result.exitCode!==0){
        const message=result.stderr.trim()||'Remote in-place save failed'
        if(!acknowledged&&/Remote file (?:has changed|changed before saving)/.test(message))throw new FileConflictError(message)
        throw new RemotePathError(message)
    }
    if(!acknowledged)throw new RemotePathError('Remote save acknowledgement missing')
    const version=result.stdout.split(`\0${marker}:VERSION:`)[1]?.split('\0')[0]
    if(!version||!/^\d+:.+$/.test(version))throw new RemotePathError('Remote save version missing')
    return 'shell:'+version
}
