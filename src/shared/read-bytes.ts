import { checkFileReadSize, fileReadLimit } from './file-size-policy'
import { t } from './i18n'
import { lstat, open } from 'node:fs/promises';

export function previewLimit(maxBytes:number):void {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>fileReadLimit('local'))throw new Error('Invalid preview size limit');
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

export async function readLocalByteRange(path:string,offset:number,maxBytes:number,signal?:AbortSignal,forEditing=false):Promise<Uint8Array> {
  previewLimit(maxBytes);if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid preview offset');signal?.throwIfAborted();
  if(forEditing&&(await lstat(path)).isSymbolicLink())throw new Error('Editing symbolic links is not supported yet');
  const file=await open(path,'r');
  try{const info=await file.stat();if(!info.isFile())throw new Error(t('只能预览普通文件'));if(offset>info.size)throw new Error(t('文件在读取时发生变化，请重新打开'));
    checkFileReadSize('local',info.size);
    const length=Math.min(maxBytes,info.size-offset),buffer=Buffer.allocUnsafe(length);let read=0;
    while(read<length){signal?.throwIfAborted();const result=await file.read(buffer,read,length-read,offset+read);if(!result.bytesRead)break;read+=result.bytesRead}
    signal?.throwIfAborted();if(read!==length)throw new Error(t('文件在读取时发生变化，请重新打开'));const after=await file.stat();
    if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new Error(t('文件在读取时发生变化，请重新打开'));return buffer;
  }finally{await file.close()}
}
