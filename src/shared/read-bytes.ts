import { textFileLimit } from './text-file-limit'
import { t } from './i18n'
import { open } from 'node:fs/promises';

export function previewLimit(maxBytes:number):void {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>textFileLimit)throw new Error('Invalid preview size limit');
}
export async function readLocalBytes(path:string,maxBytes:number,signal?:AbortSignal):Promise<Uint8Array> {
  previewLimit(maxBytes);signal?.throwIfAborted();
  const file=await open(path,'r');
  try{
    const info=await file.stat();
    if(!info.isFile())throw new Error(t('只能预览普通文件'));
    if(info.size>maxBytes)throw new Error(t`预览上限为 ${Math.floor(maxBytes/1024/1024)} MiB`);
    const chunks:Buffer[]=[];let length=0;
    while(true){
      signal?.throwIfAborted();
      const buffer=Buffer.alloc(Math.min(262144,maxBytes-length+1));
      const {bytesRead}=await file.read(buffer);
      if(!bytesRead)break;
      length+=bytesRead;if(length>maxBytes)throw new Error(t('文件超过预览大小限制'));
      chunks.push(buffer.subarray(0,bytesRead));
    }
    signal?.throwIfAborted();
    if(length!==info.size)throw new Error(t('文件在读取时发生变化，请重新打开'));
    return Buffer.concat(chunks);
  }finally{await file.close()}
}
