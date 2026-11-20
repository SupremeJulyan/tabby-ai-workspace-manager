/** Signal a binary file without relying on translated error messages. */
export class BinaryFileError extends Error {
    readonly code='ARW_BINARY_FILE'
    constructor(message='File is binary and cannot be edited as text') { super(message); this.name='BinaryFileError' }
}
export const binaryPageBytes=4096
export function formatHexPage(bytes:Uint8Array,page:number):string {
    const pages=Math.max(1,Math.ceil(bytes.length/binaryPageBytes))
    if(!Number.isInteger(page)||page<0||page>=pages)throw new RangeError('Invalid binary page')
    const lines:string[]=[],end=Math.min(bytes.length,(page+1)*binaryPageBytes)
    for(let offset=page*binaryPageBytes;offset<end;offset+=16){
        const row=bytes.subarray(offset,Math.min(offset+16,end))
        const hex=Array.from(row,value=>value.toString(16).padStart(2,'0')).join(' ')
        const ascii=Array.from(row,value=>value>=32&&value<=126?String.fromCharCode(value):'.').join('')
        lines.push(`${offset.toString(16).padStart(8,'0')}  ${hex.padEnd(47)}  |${ascii}|`)
    }
    return lines.join('\n')
}

export function isBinaryFileError(error:unknown):boolean {
    return error instanceof BinaryFileError || (typeof error==='object' && error!==null && (error as {code?:unknown}).code==='ARW_BINARY_FILE')
}
