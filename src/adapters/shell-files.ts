import { t } from '../shared/i18n'
import { decodeText } from '../shared/decode-text'
import { posix } from 'node:path'
import { type WorkspaceFile, type WorkspaceText, textFileLimit } from '../arw-tree/workspace'
import { shellQuote } from '../shared/shell-quote'
import { TabbyRelayTransport } from './transport'

export function parseShellDirectory (output:string, input:string):WorkspaceFile[] {
    const fields = output.split('\0')
    if (fields.shift() !== 'ARW_DIRECTORY_V1' || fields.pop() !== '' || fields.length % 2) throw new Error(t('SSH 目录结果不完整或被登录输出干扰'))
    const files:WorkspaceFile[] = []
    const names = new Set<string>()
    for(let index=0;index<fields.length;index+=2){
        const [type,name] = fields.slice(index,index+2)
        if(!['d','f','l'].includes(type)||!name||name==='.'||name==='..'||name.includes('/')||names.has(name))throw new Error(t('SSH 目录返回了无效条目'))
        names.add(name)
        files.push({name,path:posix.join(input,name),directory:type==='d',symlink:type==='l'})
    }
    return files.sort((left,right)=>Number(right.directory)-Number(left.directory)||left.name.localeCompare(right.name))
}

export async function listShellDirectory (transport:TabbyRelayTransport, target:string, input:string, signal?:AbortSignal):Promise<WorkspaceFile[]> {
    const script = t`cd -- ${shellQuote(target)} || exit $?
test -r . && test -x . || { printf '%s\\n' '无法读取远程目录：权限不足' >&2; exit 1; }
printf 'ARW_DIRECTORY_V1\\000'
count=0
for entry in ./.[!.]* ./..?* ./*; do
    if test -L "$entry"; then type=l
    elif test -d "$entry"; then type=d
    elif test -e "$entry"; then type=f
    else continue
    fi
    printf '%s\\000%s\\000' "$type" "\${entry#./}" || exit $?
    count=$((count+1))
    if test "$count" -ge 2001; then break; fi
done`
    const result=await transport.run(script,signal??AbortSignal.timeout(30000))
    if(result.exitCode!==0)throw new Error(result.stderr.trim()||t('无法通过 SSH 读取远程目录'))
    return parseShellDirectory(result.stdout,input)
}

export async function readShellText (transport:TabbyRelayTransport, target:string,signal?:AbortSignal):Promise<WorkspaceText> {
    const quoted=shellQuote(target)
    const result=await transport.run(t`test -f ${quoted} || { printf '%s\\n' '仅支持读取普通文本文件' >&2; exit 1; }
version=$(stat -c '%s:%y' -- ${quoted}) || exit $?
size=\${version%%:*}
test "$size" -le ${textFileLimit} || { printf '%s\\n' '文本文件上限为 500 MiB' >&2; exit 1; }
printf 'ARW_TEXT_VERSION:%s\\n' "$version"
base64 < ${quoted} || exit $?
test "$(stat -c '%s:%y' -- ${quoted})" = "$version" || { printf '%s\\n' '远端文件已变化' >&2; exit 1; }`,signal??AbortSignal.timeout(30000),{maxBytes:Math.ceil(textFileLimit/3)*4+Math.ceil(textFileLimit/57)+2048})
    signal?.throwIfAborted()
    if(result.exitCode!==0)throw new Error(result.stderr.trim()||t('无法通过 SSH 读取远程文本（需要 base64 和 stat）'))
    const newline=result.stdout.indexOf('\n'),header=result.stdout.slice(0,newline)
    if(newline<0||!/^ARW_TEXT_VERSION:\d+:.+$/.test(header))throw new Error(t('无法读取远端文件的修改时间或大小'))
    const version='shell:'+header.slice('ARW_TEXT_VERSION:'.length)
    const encoded=result.stdout.slice(newline+1).replace(/[\r\n\t ]/g,'')
    const bytes=Buffer.from(encoded,'base64')
    if(bytes.toString('base64')!==encoded)throw new Error(t('SSH 文本结果不是完整的 Base64 数据'))
    if(bytes.length>textFileLimit)throw new Error(t('文本文件上限为 500 MiB'))
    if(bytes.includes(0))throw new Error(t('暂不支持二进制文件'))
    return {content:decodeText(bytes),hash:version}
}

