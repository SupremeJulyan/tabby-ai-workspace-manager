import { t } from './i18n'

const mib=1024*1024
type FileLocation='local'|'remote'

export function fileReadLimit(kind:FileLocation):number {
    return (kind==='local'?500:5)*mib
}

export function fileWriteLimit(kind:FileLocation):number {
    return (kind==='local'?100:2)*mib
}

export function checkFileReadSize(kind:FileLocation,size:number):void {
    const limit=fileReadLimit(kind)
    if(size>limit)throw new Error(t`文件超过读取上限 ${limit/mib} MiB，无法打开。`)
}

export function checkFileWriteSize(kind:FileLocation,size:number):void {
    const limit=fileWriteLimit(kind)
    if(size>limit)throw new Error(t`文件超过写入上限 ${limit/mib} MiB，无法保存。`)
}
