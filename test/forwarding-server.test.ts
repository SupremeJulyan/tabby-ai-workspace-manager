import { ipcFetch, parseIpcConnection, NAMED_PIPE_PREFIX, isArwNamedPipe } from '../src/arw-cli/ipc-client';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ForwardingServer } from '../src/arw-cli/forwarding-server';
import { registerActiveWorkspace, workspaceCatalogPath } from '../src/arw-cli/workspace-catalog';

const execute = promisify(execFile);
test('CLI endpoint authenticates, enforces workspace identity and handles CLI read/write/exec', async t => {
  const files = new Map([['file', 'before']]);
  let commandSignal: AbortSignal | undefined;
  const server = new ForwardingServer({
    workspace: { id: 'one', root: '/project', host: 'fixture' },
    async list() { return { entries: [...files.keys()] }; },
    async read(path) { return { content: files.get(path) }; },
    async write(path, content) { files.set(path, content); return { written: true }; },
    async run(command, signal) { commandSignal = signal; return { stdout: command, stderr: '', exitCode: command === 'fail' ? 7 : 0 }; }
  });
  const directory = await mkdtemp(join(tmpdir(), 'arw-cli-test-'));
  const previousConfig=process.env.TABBY_CONFIG_DIRECTORY;
  process.env.TABBY_CONFIG_DIRECTORY=directory;
  let unregister: (()=>Promise<void>)|undefined;
  t.after(async () => {
    await unregister?.();
    if(previousConfig===undefined)delete process.env.TABBY_CONFIG_DIRECTORY;else process.env.TABBY_CONFIG_DIRECTORY=previousConfig;
    await server.stop(); await rm(directory, { recursive: true, force: true });
  });
  await server.start();
  const connection = server.connection;
  assert.equal(typeof (server as any).server.address(),'string','forwarding must bind an IPC path, not a TCP address');
  if(process.platform!=='win32'){
    assert.ok((await stat(connection.socketPath)).isSocket());
    assert.equal((await stat(connection.socketPath)).mode&0o777,0o600);
    assert.equal((await stat(dirname(connection.socketPath))).mode&0o777,0o700);
  }
  const config = join(directory, 'connection.json');
  await writeFile(config, JSON.stringify(connection), { mode: 0o600 });
  unregister=await registerActiveWorkspace(workspaceCatalogPath(),{workspaceId:'one',workspaceRoot:'/project',name:'project',host:'fixture',status:'forwarded',configPath:config});
  const cli = (...args: string[]) => execute(process.execPath,
    [resolve(__dirname, '../dist/arw.cjs'), ...args], {env: {...process.env, TABBY_CONFIG_DIRECTORY: directory}});
  assert.equal((await ipcFetch({...connection,token:'0'.repeat(64)}, { method: 'POST' })).status, 401);
  assert.equal((await ipcFetch(connection, { method: 'POST', headers: { Origin: 'https://example.test' } })).status, 403);
  assert.equal((await ipcFetch(connection,{headers:{Host:'other.local'}})).status,403);
  assert.equal((await ipcFetch(connection,{method:'GET'})).status,405);
  assert.equal((await ipcFetch(connection,{body:'invalid json'})).status,400);
  const workspaces = JSON.parse((await cli('workspaces')).stdout);
  assert.equal(workspaces.workspaces[0].workspaceId, 'one');
  await cli('write', 'file', '--id', 'one', '--content', 'after');
  assert.equal(files.get('file'), 'after');
  assert.equal(JSON.parse((await cli('read', 'file', '--id', 'one')).stdout).content, 'after');
  await assert.rejects(cli('read', 'file', '--id', 'other'), /Workspace is unavailable/);
  assert.equal((await cli('exec', '--id', 'one', '--', 'pwd')).stdout, 'pwd');
  await assert.rejects(cli('exec', '--id', 'one', '--', 'fail'), (error: any) => error.code === 7);
  const proxied=await execute(process.execPath,[resolve(__dirname,'../dist/arw.cjs'),'read','file','--id','one'],{
    env:{...process.env,TABBY_CONFIG_DIRECTORY:directory,NODE_USE_ENV_PROXY:'1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:''},
  });
  assert.equal(JSON.parse(proxied.stdout).content,'after','IPC must work with an unreachable HTTP proxy');
  await server.stop();
  if(process.platform!=='win32')await assert.rejects(access(dirname(connection.socketPath)));
  assert.equal(commandSignal?.aborted, true);
  assert.throws(() => server.connection, /not enabled/);
  await assert.rejects(ipcFetch(connection));
});


test('IPC validates connection files and Windows pipe names without accepting TCP fallback',()=>{
  const pipe=NAMED_PIPE_PREFIX+'12345678-1234-1234-1234-123456789abc';
  assert.equal(pipe,String.raw`\\.\pipe\arw-12345678-1234-1234-1234-123456789abc`);
  assert.equal(isArwNamedPipe(pipe),true);
  for(const path of ['\\server\\pipe\\arw-test',pipe+'/other',pipe+'\\other','/tmp/arw.sock'])assert.equal(isArwNamedPipe(path),false);
  for(const value of [null,{version:1,url:'http://127.0.0.1:1234/cli?token=secret'},
    {version:2,socketPath:'http://127.0.0.1:1234',token:'a'.repeat(64)},
    {version:2,socketPath:'/tmp/cli.sock',token:'short'}])assert.throws(()=>parseIpcConnection(value),/outdated CLI connection/);
})

test('IPC start and stop serialize concurrent lifecycle calls and discard old connections',async context=>{
  const directory=await mkdtemp(join(tmpdir(),'arw-ipc-lifecycle-'));
  const server=new ForwardingServer({workspace:{id:'lifecycle',root:'/project',host:'fixture'},
    list:async()=>({}),read:async()=>({}),write:async()=>({}),run:async()=>({})},join(directory,'audit.jsonl'));
  context.after(async()=>{await server.stop();await rm(directory,{recursive:true,force:true})});
  const opening=server.start();const closing=server.stop();
  await Promise.all([opening,closing]);assert.throws(()=>server.connection,/not enabled/);
  await Promise.all([server.start(),server.start()]);
  const previous=server.connection;
  await Promise.all([server.stop(),server.stop()]);
  if(process.platform!=='win32')await assert.rejects(access(dirname(previous.socketPath)));
  await server.start();assert.notEqual(server.connection.socketPath,previous.socketPath);
  assert.notEqual(server.connection.token,previous.token);
  await assert.rejects(ipcFetch(previous));
  const controller=new AbortController();controller.abort();
  await assert.rejects(ipcFetch(server.connection,{signal:controller.signal}),{name:'AbortError'});
  const response=await ipcFetch(server.connection,{body:JSON.stringify({name:'list_remote_workspaces',arguments:{}})});
  assert.equal(response.status,200);
})


test('Unix IPC remains usable when the configured temporary path exceeds socket limits',{skip:process.platform==='win32'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'arw-long-temp-')),previous=process.env.TMPDIR;
  const server=new ForwardingServer({workspace:{id:'long-temp',root:'/project',host:'fixture'},
    list:async()=>({}),read:async()=>({}),write:async()=>({}),run:async()=>({})},join(directory,'audit.jsonl'));
  try{
    process.env.TMPDIR=join(directory,'nested'.repeat(30));
    await server.start();
    const result=await ipcFetch(server.connection,{body:JSON.stringify({name:'list_remote_workspaces',arguments:{}})});
    assert.equal((await result.json()).result.workspaces[0].workspaceId,'long-temp');
    assert.ok(Buffer.byteLength(server.connection.socketPath)<=100);
  }finally{
    if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;
    await server.stop();await rm(directory,{recursive:true,force:true});
  }
})
