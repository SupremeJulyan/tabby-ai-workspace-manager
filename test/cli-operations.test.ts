import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ForwardingServer } from '../src/arw-cli/forwarding-server';
import { selectText } from '../src/arw-cli/operations';
import { sftpCopy } from '../src/adapters/sftp-copy';
import { RemotePathGuard } from '../src/security/remote-path';
import { sftpFixture } from './sftp-copy-fixture';
import { localWorkspace } from '../src/arw-tree/workspace';
import { registerActiveWorkspace, workspaceCatalogPath } from '../src/arw-cli/workspace-catalog';
const execute = promisify(execFile);
import { writeWorkspaceBinding } from '../src/arw-cli/workspace-binding';

test('CLI uses its exact directory binding, not inherited environment or parent bindings',async t=>{
  const root=await mkdtemp(join(tmpdir(),'arw-bound-cli-'));
  const servers:ForwardingServer[]=[],unregister:Array<()=>Promise<void>>=[];
  let terminalMode=false;
  t.after(async()=>{for(const remove of unregister)await remove();await Promise.all(servers.map(server=>server.stop()));await rm(root,{recursive:true,force:true,maxRetries:5})});
  for(const id of ['one','two']){
    const server=new ForwardingServer({workspace:{id,root:`/projects/${id}`,host:'fixture'},terminalOnly:()=>terminalMode,
      list:async()=>({entries:[]}),read:async()=>({content:id,hash:id}),write:async(_path,content)=>({content,hash:id}),
      run:async()=>({stdout:id,stderr:'',exitCode:0})});
    servers.push(server);await server.start();
    const config=join(root,`${id}.json`);await writeFile(config,JSON.stringify(server.connection));
    unregister.push(await registerActiveWorkspace(join(root,'omw','workspaces.json'),{workspaceId:id,workspaceRoot:`/projects/${id}`,name:id,host:'fixture',port:2222,user:'alice',status:'forwarded',configPath:config}));
  }
  const binding={version:2 as const,kind:'remote' as const,workspaceId:'one',remoteRoot:'/projects/one',host:'fixture',port:2222,user:'alice',terminalOnly:false,catalogPath:join(root,'omw','workspaces.json')};
  writeWorkspaceBinding(root,binding);
  const env={...process.env,TABBY_CONFIG_DIRECTORY:root,ARW_WORKSPACE_ID:'two',ARW_WORKSPACE_ROOT:'/wrong/local/project',ARW_WORKSPACE_KIND:'local'};
  const cli=(args:string[],overrides:Record<string,string>={})=>execute(process.execPath,[resolve('dist/arw.cjs'),...args],{cwd:root,env:{...env,...overrides}});
  assert.equal(JSON.parse((await cli(['read','file'])).stdout).content,'one');
  assert.equal(JSON.parse((await cli(['write','file','--content','updated'])).stdout).content,'updated');
  assert.equal((await cli(['exec','pwd'])).stdout,'one');
  terminalMode=true;
  assert.equal((await cli(['exec','pwd'])).stdout,'one');
  await assert.rejects(cli(['read','file']),/Terminal mode only supports arw exec/);
  terminalMode=false;
  assert.equal(JSON.parse((await cli(['workspaces'])).stdout).workspaces.length,2);
  assert.equal(JSON.parse((await cli(['read','file','--id','two'])).stdout).content,'two');
  assert.equal(JSON.parse((await cli(['read','file','--workspace','two'])).stdout).content,'two');
  for(const change of [{host:'other'},{port:22},{user:'bob'},{remoteRoot:'/projects/two'}]){
    await writeFile(join(root,'.awm','workspace.json'),JSON.stringify({...binding,...change}));
    await assert.rejects(cli(['read','file']),/identity has changed/);
  }
  await writeFile(join(root,'.awm','workspace.json'),JSON.stringify(binding));
  const child=join(root,'child');await mkdir(child);
  await assert.rejects(execute(process.execPath,[resolve('dist/arw.cjs'),'read','file'],{cwd:child,env}),/--id is required/);
  await writeFile(join(root,'.awm','workspace.json'),'invalid');
  await assert.rejects(cli(['read','file']),/JSON|Unexpected/);
  await writeFile(join(root,'.awm','workspace.json'),JSON.stringify({...binding,catalogPath:'relative'}));
  await assert.rejects(cli(['read','file']),/Invalid .*binding/);
  await writeFile(join(root,'.awm','workspace.json'),JSON.stringify(binding));
  await unregister[0]();
  await assert.rejects(cli(['read','file']),/Bound workspace is unavailable/);
  assert.equal(JSON.parse((await cli(['read','file','--id','two'])).stdout).content,'two');
  const replacement=new ForwardingServer({workspace:{id:'one',root:'/projects/one',host:'fixture'},
    list:async()=>({entries:[]}),read:async()=>({content:'reconnected',hash:'new'}),write:async()=>({}),run:async()=>({stdout:'',stderr:'',exitCode:0})});
  servers.push(replacement);await replacement.start();
  const replacementConfig=join(root,'replacement.json');await writeFile(replacementConfig,JSON.stringify(replacement.connection));
  unregister.push(await registerActiveWorkspace(join(root,'omw','workspaces.json'),{workspaceId:'one',workspaceRoot:'/projects/one',name:'one',host:'fixture',port:2222,user:'alice',status:'forwarded',configPath:replacementConfig}));
  assert.equal(JSON.parse((await cli(['read','file'])).stdout).content,'reconnected');
});

test('expanded CLI performs structured reads, searches, edits, file management and ordered batches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arw-operations-'));
  const workspace = localWorkspace(root);
  const gitCalls: {direction:string,path:string}[] = [];
  const server = new ForwardingServer({workspace: {id: 'fixture', root, host: 'localhost'},
    git: async (direction, path, signal) => {
      signal.throwIfAborted(); gitCalls.push({direction,path});
      return {direction, status: direction === 'pull' ? 'up-to-date' : 'pushed'};
    },
    copy: sftpCopy(async () => sftpFixture(), new RemotePathGuard(root, (command, signal) => workspace.run(command, signal))),
    list: async path => ({entries: await workspace.list(path)}),
    read: path => workspace.read(path),
    write: (path, content, _signal, hash) => workspace.write(path, content, hash),
    currentFile: () => ({path: join(root, 'a.txt'), dirty: false}),
    run: (command, signal, options) => workspace.run(command, signal, options),
  }, join(root, 'audit.jsonl'));
  await server.start();
  const config = join(root, 'connection.json');
  await writeFile(config, JSON.stringify(server.connection));
  const previousConfig=process.env.TABBY_CONFIG_DIRECTORY;
  process.env.TABBY_CONFIG_DIRECTORY=root;
  const unregister=await registerActiveWorkspace(workspaceCatalogPath(),{workspaceId:'fixture',workspaceRoot:root,name:'fixture',host:'localhost',status:'forwarded',configPath:config});
  t.after(async () => {
    await unregister();
    if(previousConfig===undefined)delete process.env.TABBY_CONFIG_DIRECTORY;else process.env.TABBY_CONFIG_DIRECTORY=previousConfig;
    await server.stop(); await rm(root, {recursive: true, force: true});
  });
  const cli = async (...args: string[]) => JSON.parse((await execute(process.execPath, [resolve('dist/arw.cjs'), '--id', 'fixture', ...args], {env: {...process.env, TABBY_CONFIG_DIRECTORY: root}})).stdout);
  assert.equal((await cli('git-pull')).status, 'up-to-date');
  assert.equal((await cli('git-push', 'nested/repo')).status, 'pushed');
  await cli('git-pull', '--path', 'another/repo');
  assert.deepEqual(gitCalls, [{direction:'pull',path:'.'},{direction:'push',path:'nested/repo'},{direction:'pull',path:'another/repo'}]);
  await assert.rejects(cli('git-push', '--input', '{"force":true}'), /Unsupported/);
  await assert.rejects(cli('git', 'pull'), /Unsupported/);
  await assert.rejects(cli('cp', 'a', 'b'), /Unsupported/);
  await assert.rejects(cli('batch', '--input', '{"operations":[{"command":"git-push"}]}'), /Unsupported batch command/);
  assert.equal(gitCalls.length, 3);
  await writeFile(join(root, 'a.txt'), 'one\n你好\nthree\n');
  assert.equal((await cli('current-file')).file.path, join(root, 'a.txt'));
  assert.equal((await cli('read', 'a.txt', '--head', '2')).content, 'one\n你好\n');
  assert.equal((await cli('read', '--path', 'a.txt', '--tail', '1')).content, 'three\n');
  assert.equal((await cli('read', 'a.txt', '--start-line', '2', '--line-count', '1')).content, '你好\n');
  assert.equal((await cli('read', 'a.txt', '--offset', '4', '--length', '6')).content, '你好');
  await assert.rejects(cli('read', 'a.txt', '--head', '1', '--tail', '1'), /Choose/);
  const page = await cli('list', '--limit', '1');
  assert.equal(page.entries.length, 1); assert.equal(page.nextCursor, '1');
  assert.equal((await cli('list', '--limit', '1', '--cursor', '1')).entries.length, 1);
  assert.deepEqual((await cli('find', '*.txt')).results, [{path: 'a.txt'}]);
  assert.deepEqual((await cli('search', '你好', '--mode', 'files', '--input', '{"include":"*.txt"}')).results, [{path: 'a.txt'}]);
  const reads = await cli('read-many', '--input', '{"requests":[{"path":"a.txt","head":1},{"path":"a.txt","tail":1}]}');
  assert.equal(reads.results[1].content, 'three\n');
  await writeFile(join(root, 'source.bin'), Buffer.from([0, 255, 128, 1]));
  await cli('create', 'folder-upload', 'directory');
  const binary = Buffer.alloc(2 * 1024 * 1024 + 11, 0x81); binary[0] = 0;
  await writeFile(join(root, 'source.bin'), binary);
  await cli('upload', join(root, 'source.bin'), 'folder-upload/source.bin');
  await cli('download', 'folder-upload/source.bin', join(root, 'downloaded.bin'));
  assert.deepEqual(await readFile(join(root, 'downloaded.bin')), binary);
  await cli('download', '-r', 'folder-upload', join(root, 'downloaded-folder'));
  assert.deepEqual(await readFile(join(root, 'downloaded-folder/source.bin')), binary);
  await assert.rejects(cli('download', 'folder-upload/source.bin', join(root, 'downloaded.bin')), /exists/);
  await assert.rejects(cli('upload', join(root, 'source.bin'), 'folder-upload/source.bin'), /exists/);
  await assert.rejects(cli('download', 'folder-upload', join(root, 'missing-directory')), /download -r/);
  const command = await execute(process.execPath, [resolve('dist/arw.cjs'), '--id', 'fixture', 'exec', "printf '%070000d' 1"], {env: {...process.env, TABBY_CONFIG_DIRECTORY: root}});
  assert.equal(command.stdout.length, 32768);
  const metadata = JSON.parse(command.stderr);
  const continued = await cli('output', metadata.outputId, 'stdout', '--offset', String(metadata.nextOffsets.stdout));
  assert.equal(continued.content.length, 70000 - 32768);
  assert.equal(continued.truncated, false);
  const large = await execute(process.execPath, [resolve('dist/arw.cjs'), '--id', 'fixture', 'exec', "printf '%01200000d' 1"], {env: {...process.env, TABBY_CONFIG_DIRECTORY: root}});
  const largeMetadata = JSON.parse(large.stderr);
  const end = await cli('output', largeMetadata.outputId, 'stdout', '--offset', '1199990');
  assert.equal(end.content, '0000000001');
  assert.equal((await cli('read', 'a.txt', '--compact')).truncated, undefined);
  assert.equal((await cli('exec', '--command', 'printf test', '--verbose')).stdout, 'test');
  const version = await execute(process.execPath, [resolve('dist/arw.cjs'), '--version']);
  assert.match(version.stdout, /^arw \d+\.\d+\.\d+/);
  await assert.rejects(cli('output', 'missing', 'stdout'), /expired/);
  await cli('edit', 'a.txt', '--input', '{"edits":[{"oldText":"one","newText":"first"}]}');
  assert.match(await readFile(join(root, 'a.txt'), 'utf8'), /^first/);
  await assert.rejects(cli('edit', 'a.txt', '--input', '{"expectedHash":"stale","edits":[{"oldText":"first","newText":"bad"}]}'), /changed/);
  await cli('create', 'folder', 'directory');
  await cli('create', 'folder/new', 'file', '--content', 'payload');
  await assert.rejects(cli('create', 'folder/new', 'file'), /failed|exists/i);
  await cli('chmod', 'folder/new', '640');
  assert.equal((await stat(join(root, 'folder/new'))).mode & 0o777, 0o640);
  await cli('move', '--input', '{"sourcePath":"folder/new","targetPath":"folder/moved"}');
  assert.equal(await readFile(join(root, 'folder/moved'), 'utf8'), 'payload');
  await assert.rejects(cli('delete', 'folder'), /failed|empty/i);
  await cli('delete', 'folder', '--input', '{"recursive":true}');
  await assert.rejects(cli('delete', '.', '--input', '{"recursive":true}'), /workspaceRoot/);
  await symlink(join(root, 'a.txt'), join(root, 'linked'));
  await assert.rejects(cli('delete', 'linked'), /symbolic/);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'first\n你好\nthree\n');
  await symlink(tmpdir(), join(root, 'escape'));
  await assert.rejects(cli('create', 'escape/forbidden', 'file'), /escapes/);
  await assert.rejects(cli('upload', join(root, 'source.bin'), 'escape/forbidden'), /escapes/);
  await assert.rejects(cli('read', 'a.txt', '--config', config), /Unknown option/);
  const rawCli = (...args: string[]) => execute(process.execPath, [resolve('dist/arw.cjs'), ...args], {env: {...process.env, TABBY_CONFIG_DIRECTORY: root}});
  await assert.rejects(rawCli('read', 'a.txt'), /--id is required/);
  await assert.rejects(rawCli('read', 'a.txt', '--workspace', 'missing'), /Workspace is unavailable/);
  await assert.rejects(cli('read', 'a.txt', '--id', 'missing'), /Workspace is unavailable/);
  await assert.rejects(cli('workspaces'), /does not accept --id/);
  await assert.rejects(cli('install'), /Unsupported/);
  await assert.rejects(cli('upload'), /local path must be a string/);
  await assert.rejects(cli('read', 'a.txt', '--input', '{"workspaceId":"other"}'), /Unsupported/);
  await assert.rejects(cli('batch', '--input', '{"operations":[{"command":"write","arguments":{"path":"a.txt","content":"updated"}},{"command":"read","arguments":{"path":"missing"}},{"command":"write","arguments":{"path":"a.txt","content":"wrong"}}]}'));
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'updated');
});

test('UTF-8 continuation always advances and does not split a character', () => {
  const selected = selectText('你好', {offset: 0, length: 1});
  assert.equal(selected.content, '你');
  assert.equal(selected.nextOffset, 3);
  assert.equal(selectText('你好', {offset: selected.nextOffset, length: 1}).content, '好');
  assert.throws(() => selectText('text', {head: -1}), /integer/);
  assert.throws(() => selectText('text', {offset: 0, tail: 2}), /Choose/);
});
