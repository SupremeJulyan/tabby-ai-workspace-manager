/** Decode UTF-8 while replacing invalid byte sequences so editors can still open the file. */
export function decodeText(bytes:Uint8Array):string {
    return new TextDecoder('utf-8').decode(bytes)
}
