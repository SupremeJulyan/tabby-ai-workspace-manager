import { t } from '../shared/i18n'
import { posix } from 'node:path'
import { type WorkspaceFile, textFileLimit } from '../arw-tree/workspace'
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

export async function readShellText (transport:TabbyRelayTransport, target:string,signal?:AbortSignal):Promise<string> {
    const quoted=shellQuote(target)
    const result=await transport.run(t`test -f ${quoted} || { printf '%s\\n' '仅支持读取普通文本文件' >&2; exit 1; }
size=$(wc -c < ${quoted}) || exit $?
test "$size" -le 10485760 || { printf '%s\\n' '文本文件上限为 10 MiB' >&2; exit 1; }
base64 < ${quoted}`,signal??AbortSignal.timeout(30000),{maxBytes:14*1024*1024})
    signal?.throwIfAborted()
    if(result.exitCode!==0)throw new Error(result.stderr.trim()||t('无法通过 SSH 读取远程文本（需要 base64 和 wc）'))
    const encoded=result.stdout.replace(/[\r\n\t ]/g,'')
    const bytes=Buffer.from(encoded,'base64')
    if(bytes.toString('base64')!==encoded)throw new Error(t('SSH 文本结果不是完整的 Base64 数据'))
    if(bytes.length>textFileLimit)throw new Error(t('文本文件上限为 10 MiB'))
    if(bytes.includes(0))throw new Error(t('暂不支持二进制文件'))
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}

