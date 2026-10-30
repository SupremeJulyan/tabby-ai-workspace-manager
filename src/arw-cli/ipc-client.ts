import { request } from 'node:http';
import { isAbsolute } from 'node:path';

export const NAMED_PIPE_PREFIX=String.raw`\\.\pipe\arw-`;
export function isArwNamedPipe(path:string):boolean {
  return path.startsWith(NAMED_PIPE_PREFIX)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path.slice(NAMED_PIPE_PREFIX.length));
}

export interface IpcConnection { version: 2; socketPath: string; token: string }
export function parseIpcConnection(value: unknown): IpcConnection {
  const config=value as Partial<IpcConnection>|null;
  if(!config||config.version!==2||typeof config.socketPath!=='string'||config.socketPath.includes('\0')
    ||typeof config.token!=='string'||!/^[a-f0-9]{64}$/.test(config.token)
    ||(process.platform==='win32'?!isArwNamedPipe(config.socketPath):!isAbsolute(config.socketPath))) {
    throw new Error('Invalid or outdated CLI connection file; restart Tabby to recreate the workspace connection');
  }
  return {version:2,socketPath:config.socketPath,token:config.token};
}

/** HTTP framing over OS IPC only: no DNS lookup, proxy or TCP fallback. */
export function ipcFetch(connection:unknown,init:{method?:string;headers?:Record<string,string>;body?:string;signal?:AbortSignal}={}):Promise<Response> {
  const config=parseIpcConnection(connection);
  return new Promise((resolve,reject)=>{
    const call=request({socketPath:config.socketPath,path:'/cli',method:init.method??'POST',agent:false,
      headers:{Host:'arw.local',Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',...init.headers},
      signal:init.signal??AbortSignal.timeout(600_000)},response=>{
      const chunks:Buffer[]=[];
      response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      response.on('error',reject);
      response.on('aborted',()=>reject(new Error('IPC response was interrupted; check remote state before retrying mutations')));
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode??502})));
    });
    call.on('error',reject);
    call.end(init.body);
  });
}
