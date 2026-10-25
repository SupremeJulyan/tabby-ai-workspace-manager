import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sftpCopy } from '../src/adapters/sftp-copy';
import { RemotePathGuard } from '../src/security/remote-path';
import { localWorkspace } from '../src/arw-tree/workspace';
import { registerActiveWorkspace, readWorkspaceCatalog, writeWorkspaceCatalog } from '../src/arw-cli/workspace-catalog';
import { sftpFixture } from './sftp-copy-fixture';

test('SFTP copy publishes only complete files and removes failed, cancelled and disconnected transfers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arw-sftp-copy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const workspace = localWorkspace(root), controller = new AbortController();
  const sftp = sftpFixture();
  const copy = sftpCopy(async () => sftp, new RemotePathGuard(root, (command, signal) => workspace.run(command, signal)));
  const invoke = (args: Record<string, unknown>) => copy(args, controller.signal) as Promise<Record<string, unknown>>;
  const first = await invoke({action:'open-write', path:'file'});
  await invoke({action:'write', transferId:first.transferId, data:Buffer.from('complete').toString('base64')});
  await assert.rejects(readFile(join(root,'file')), {code:'ENOENT'});
  await invoke({action:'close', transferId:first.transferId});
  assert.equal(await readFile(join(root,'file'),'utf8'),'complete');
  await assert.rejects(invoke({action:'open-write',path:'file'}), /exists/);
  const failed = await invoke({action:'open-write',path:'failed'});
  await assert.rejects(invoke({action:'write',transferId:failed.transferId,data:'invalid!'}), /Invalid/);
  const cancelled = await invoke({action:'open-write',path:'cancelled'});
  await invoke({action:'cancel',transferId:cancelled.transferId});
  const interrupted = await invoke({action:'open-write',path:'interrupted'});
  controller.abort();
  for (let attempt=0; attempt<50 && (await readdir(root)).some(name=>name.startsWith('.arw-copy-')); attempt++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(await readdir(root),['file']);
  await assert.rejects(invoke({action:'write',transferId:interrupted.transferId,data:'eA=='}));
});

test('manual forwards are discoverable without a connection option and survive saved catalog rewrites', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arw-live-catalog-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const catalog = join(root,'omw/workspaces.json');
  const remove = await registerActiveWorkspace(catalog, {workspaceId:'manual',workspaceRoot:'/project',name:'project',host:'host',status:'forwarded',configPath:'/private/connection.json'});
  assert.equal((await readWorkspaceCatalog(catalog)).workspaces[0].workspaceId,'manual');
  await writeWorkspaceCatalog(catalog,[]);
  assert.equal((await readWorkspaceCatalog(catalog)).workspaces[0].workspaceId,'manual');
  assert.doesNotMatch(JSON.stringify(await readWorkspaceCatalog(catalog)), /pid/);
  await remove();
  assert.deepEqual(await readWorkspaceCatalog(catalog), {workspaces:[]});
});
