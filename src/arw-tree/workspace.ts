import { readLocalBytes } from '../shared/read-bytes';
import { shellQuote } from '../shared/shell-quote';
import { open, readFile, readdir, opendir, stat, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { executeCaptured } from '../shared/process';
import type { GitResult } from './git/remote-git';
import { watchLocalDirectory } from '../shared/watch-directory';
import { inheritedWorkspaceName, leafName } from '../shared/workspace-name';
import { t } from '../shared/i18n';
import { decodeText } from '../shared/decode-text';
import { FileConflictError } from '../shared/file-conflict';

export interface WorkspaceFile { name: string; path: string; directory: boolean; symlink: boolean }
// `hash` is an opaque revision token: remote files use modification time and size.
export interface WorkspaceText { content: string; hash: string }
import { textFileLimit } from '../shared/text-file-limit'
export { textFileLimit } from '../shared/text-file-limit'
export interface Workspace {
  saveIssue?(path:string):{message:string;busy:boolean}|undefined;
  verifySave?(path:string):Promise<WorkspaceText>;
  reloadSave?(path:string):Promise<WorkspaceText>;
  retrySave?(path:string,content:string):Promise<WorkspaceText>;
  readonly waitForConnection?:boolean;
  readonly connectionStatus?:string;
  sourceWorkspace?: Workspace;
  validateCommand?(command: string, signal?: AbortSignal): Promise<void>;
  watch?(changed: () => void, failed: (error: Error) => void, signal: AbortSignal, directories?:()=>string[]): Promise<void>;
  watchSnapshot?(directories: () => string[], changed: (inputs?:string[]) => void, signal: AbortSignal): Promise<void>;
  id: string; kind: 'local' | 'remote'; root: string; host: string; label: string; name: string; titleName?:string;
  list(path: string, signal?: AbortSignal): Promise<WorkspaceFile[]>;
  listForGit?(path:string,limit:number,signal?:AbortSignal):Promise<{entries:WorkspaceFile[];truncated:boolean}>;
  read(path: string, signal?:AbortSignal): Promise<WorkspaceText>;
  readBytes?(path:string,maxBytes:number,signal?:AbortSignal):Promise<Uint8Array>;
  write(path: string, content: string, expectedHash?: string): Promise<WorkspaceText>;
  run(command: string, signal?: AbortSignal, options?: {maxBytes?: number}): Promise<GitResult>;
  runGit?(args:string[],signal?:AbortSignal,options?:{maxBytes?:number}):Promise<GitResult>;
}
const childRoot = (root: string, input: string) => input === '.' ? root
    : root.endsWith('/') ? `${root}${input}` : `${root}/${input}`
/** The same backend, scoped to a project added beneath a workspace. */
export function projectWorkspace (workspace: Workspace, root: string): Workspace {
    if (root === '.' || root === workspace.root) return workspace
    const absolute = childRoot(workspace.root, root)
    return {
        sourceWorkspace: workspace,
        id: `${workspace.id}:${root}`, kind: workspace.kind, host: workspace.host, label: absolute, root, name: leafName(root), titleName: inheritedWorkspaceName(workspace.kind,workspace.name),
        get waitForConnection(){return workspace.waitForConnection},
        get connectionStatus(){return workspace.connectionStatus},
        list: (path, signal) => workspace.list(childRoot(root, path), signal),
        read: (path,signal) => workspace.read(childRoot(root, path),signal),
        saveIssue:workspace.saveIssue ? path=>workspace.saveIssue!(childRoot(root,path)) : undefined,
        verifySave:workspace.verifySave ? path=>workspace.verifySave!(childRoot(root,path)) : undefined,
        reloadSave:workspace.reloadSave ? path=>workspace.reloadSave!(childRoot(root,path)) : undefined,
        retrySave:workspace.retrySave ? (path,content)=>workspace.retrySave!(childRoot(root,path),content) : undefined,
        readBytes: workspace.readBytes ? (path,maxBytes,signal)=>workspace.readBytes!(childRoot(root,path),maxBytes,signal) : undefined,
        write: (path, content, expectedHash) => workspace.write(childRoot(root, path), content, expectedHash),
        run: (command, signal) => workspace.run(workspace.kind === 'remote' ? `cd -- ${shellQuote(absolute)} && ${command}` : command, signal),
        runGit:workspace.runGit?(args,signal,options)=>workspace.runGit!(['-C',root,...args],signal,options):undefined,
    }
}
export const textHash = (content: string) => createHash('sha256').update(content).digest('hex');
export function localWorkspace(root: string, id: string = randomUUID()): Workspace {
  root = resolve(root);
  const filePath = (input: string) => {
    const target = resolve(root, input), rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('Path is outside this workspace');
    return target;
  };
  const read = async (input: string) => {
    const target = resolve(root,input);
    const info=await lstat(target);
    if(info.isSymbolicLink())throw new Error('Editing symbolic links is not supported yet');
    if(!info.isFile())throw new Error('Only regular files can be read');
    if(info.size > textFileLimit) throw new Error('Text files are limited to 500 MiB');
    const bytes = await readFile(target);
    if (bytes.length > textFileLimit || bytes.includes(0)) throw new Error('File is too large or binary');
    const content = decodeText(bytes);
    return { content, hash: textHash(content) };
  };
  const snapshot = async (target:string) => {
    const info=await lstat(target);
    if(info.isSymbolicLink())throw new Error('Editing symbolic links is not supported yet');
    if(!info.isFile())throw new Error('Only regular files can be saved');
    return {dev:info.dev,ino:info.ino,mode:info.mode,uid:info.uid,gid:info.gid,size:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs};
  };
  const sameSnapshot=(left:Awaited<ReturnType<typeof snapshot>>,right:Awaited<ReturnType<typeof snapshot>>)=>
    left.dev===right.dev&&left.ino===right.ino&&left.mode===right.mode&&left.uid===right.uid&&left.gid===right.gid&&left.size===right.size&&left.mtimeMs===right.mtimeMs&&left.ctimeMs===right.ctimeMs;
  return {
    id, kind: 'local', root, host: 'localhost', label: root, name: leafName(root), titleName: leafName(root),
    watch: (changed, failed, signal, directories) => watchLocalDirectory(root, changed, failed, signal, directories),
    async listForGit(input,limit,signal) {
      const entries:WorkspaceFile[]=[];let truncated=false
      const directory=await opendir(resolve(root,input))
      for await(const entry of directory){
        signal?.throwIfAborted()
        if(entries.length>=limit){truncated=true;break}
        entries.push({name:entry.name,path:join(input,entry.name),directory:entry.isDirectory(),symlink:entry.isSymbolicLink()})
      }
      return {entries,truncated}
    },
    async list(input, signal) {
      signal?.throwIfAborted();
      const entries = await readdir(resolve(root,input), { withFileTypes: true });
      signal?.throwIfAborted();
      return entries.map(entry => ({ name: entry.name, path: join(input, entry.name), directory: entry.isDirectory(), symlink: entry.isSymbolicLink() }))
        .sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
    },
    read,
    readBytes:async(input,maxBytes,signal)=>readLocalBytes(resolve(root,input),maxBytes,signal),
    async write(input, content, expectedHash) {
      if (Buffer.byteLength(content) > textFileLimit) throw new Error('Text files are limited to 500 MiB');
      const target = filePath(input);
      let before:Awaited<ReturnType<typeof snapshot>>|undefined;
      try{before=await snapshot(target)}catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
      }
      if (expectedHash !== undefined && (await read(input)).hash !== expectedHash) throw new FileConflictError('File changed on disk. Reopen it before saving.');
      const file=await open(target,before?'r+':'wx',0o600);
      try{
        if(before){
          const current=await snapshot(target);
          if(!sameSnapshot(before,current)||!sameSnapshot(before,await file.stat()))throw new FileConflictError('File metadata changed on disk. Reopen it before saving.');
        }
        await file.truncate(0);
        await file.writeFile(content,'utf8');
        if(before){
          const after=await snapshot(target);
          if(after.dev!==before.dev||after.ino!==before.ino)throw new Error('File changed on disk during save.');
          if(after.uid!==before.uid||after.gid!==before.gid||(after.mode&0o1777)!==(before.mode&0o1777))throw new Error('File permissions changed during save.');
        }
      }finally{await file.close()}
      return { content, hash: textHash(content) };
    },
    run(command, signal, options) {
      return executeCaptured({ command: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        args: process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], cwd: root }, signal, options?.maxBytes);
    },
    runGit(args,signal,options){
      signal?.throwIfAborted();
      return executeCaptured({command:'git',args:['--no-pager','--literal-pathspecs',...args],cwd:root,
        env:{LC_ALL:'C',LANGUAGE:'C',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}},signal,options?.maxBytes);
    }
  };
}
