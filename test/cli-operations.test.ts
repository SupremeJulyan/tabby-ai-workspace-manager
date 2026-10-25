import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink, stat } from 'node:fs/promises';
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

test('expanded CLI performs structured reads, searches, edits, file management and ordered batches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arw-operations-'));
  const workspace = localWorkspace(root);
  const server = new ForwardingServer({workspace: {id: 'fixture', root, host: 'localhost'},
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
  await cli('cp', join(root, 'source.bin'), 'remote:folder-upload/source.bin');
  await cli('cp', 'remote:folder-upload/source.bin', join(root, 'downloaded.bin'));
  assert.deepEqual(await readFile(join(root, 'downloaded.bin')), binary);
  await cli('cp', '-r', 'remote:folder-upload', join(root, 'downloaded-folder'));
  assert.deepEqual(await readFile(join(root, 'downloaded-folder/source.bin')), binary);
  await assert.rejects(cli('cp', 'remote:folder-upload/source.bin', join(root, 'downloaded.bin')), /exists/);
  await assert.rejects(cli('cp', join(root, 'source.bin'), 'remote:folder-upload/source.bin'), /exists/);
  await assert.rejects(cli('cp', 'remote:folder-upload', join(root, 'missing-directory')), /cp -r/);
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
  await assert.rejects(cli('cp', join(root, 'source.bin'), 'remote:escape/forbidden'), /escapes/);
  await assert.rejects(cli('read', 'a.txt', '--config', config), /Unknown option/);
  const rawCli = (...args: string[]) => execute(process.execPath, [resolve('dist/arw.cjs'), ...args], {env: {...process.env, TABBY_CONFIG_DIRECTORY: root}});
  await assert.rejects(rawCli('read', 'a.txt'), /--id is required/);
  await assert.rejects(rawCli('read', 'a.txt', '--workspace', 'missing'), /Workspace is unavailable/);
  await assert.rejects(cli('read', 'a.txt', '--id', 'missing'), /Workspace is unavailable/);
  await assert.rejects(cli('workspaces'), /does not accept --id/);
  await assert.rejects(cli('install'), /Unsupported/);
  await assert.rejects(cli('upload'), /Unsupported/);
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
