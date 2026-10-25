import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import { shellQuote } from '../shared/shell-quote'
import { isRemotePathInsideRoot, RemotePathError } from '../security/remote-path'
import type { TabbyRelayTransport } from './transport'

export async function saveRemoteText(
    transport:TabbyRelayTransport,root:string,input:string,content:string,expectedHash:string|undefined,
    signal:AbortSignal,recordPermissions:(permissions:string)=>void,started:()=>void,
):Promise<void> {
    if(!posix.isAbsolute(root)||/[\x00-\x1f\x7f]/.test(root+input))throw new RemotePathError('Invalid remote path')
    const target=posix.resolve(root,input)
    if(!isRemotePathInsideRoot(root,target))throw new RemotePathError('Path is outside workspaceRoot')
    if(expectedHash!==undefined&&!/^[a-f0-9]{64}$/.test(expectedHash))throw new RemotePathError('Invalid content hash')
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
    ${expectedHash===undefined?'':`exec 4< ${quoted} || exit 1
    _arw_prefix=$(dd bs=3 count=1 <&4 2>/dev/null) || exit 1
    if test "$_arw_prefix" = "$(printf '\\357\\273\\277')"; then
        _arw_hash=$(sha256sum <&4) || exit 1
    else
        _arw_hash=$(sha256sum < ${quoted}) || exit 1
    fi
    exec 4<&-
    test "\${_arw_hash%% *}" = ${shellQuote(expectedHash)} || { printf '%s\\n' 'Remote file has changed (远端文件已变化)' >&2; exit 1; }`}
    test "$(_arw_stat)" = "$_arw_before" || { printf '%s\\n' 'Remote file changed before saving (远端文件在保存前发生了变化)' >&2; exit 1; }
else
    ${expectedHash===undefined?':':`printf '%s\\n' 'Remote file has changed (远端文件已变化)' >&2; exit 1`}
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
if test $((0$_arw_mode & 06000)) -ne 0; then
    _arw_current=$(_arw_stat) || exit 1
    IFS=: read -r _arw_now_dev _arw_now_ino _arw_now_links _arw_now_mode _arw_now_uid _arw_now_gid _arw_rest <<ARW_METADATA
$_arw_current
ARW_METADATA
    test "$_arw_now_dev:$_arw_now_ino:$_arw_now_links:$_arw_now_uid:$_arw_now_gid" = "$_arw_dev:$_arw_ino:$_arw_links:$_arw_uid:$_arw_gid" || exit 1
    test $((0$_arw_now_mode & 01777)) -eq $((0$_arw_mode & 01777)) || exit 1
    chmod "$_arw_mode" -- ${quoted} || exit 1
    test "$(stat -c '%a:%u:%g' -- ${quoted})" = "$_arw_mode:$_arw_uid:$_arw_gid" || { printf '%s\\n' 'Remote permissions changed during save (远端文件权限在保存时发生了变化)' >&2; exit 1; }
fi`,signal,{
        input:bytes,inputReadyMarker:ready,maxBytes:16384,
        onStdout:output=>{
            const records=output.split(`\0${marker}:PERMISSIONS:`).slice(1)
            for(const record of records){
                const end=record.indexOf('\0')
                if(end<0)continue
                const permissions=record.slice(0,end)
                if(/^[0-7]+:\d+:\d+$/.test(permissions))recordPermissions(permissions)
            }
            if(!acknowledged&&output.includes(begin)){acknowledged=true;started()}
        },
    })
    signal.throwIfAborted()
    if(result.exitCode!==0)throw new RemotePathError(result.stderr.trim()||'Remote in-place save failed')
    if(!acknowledged)throw new RemotePathError('Remote save acknowledgement missing')
}
