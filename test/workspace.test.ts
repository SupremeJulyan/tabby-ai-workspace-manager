import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { truncate, mkdtemp, writeFile, readFile, mkdir, rm, symlink, stat, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localWorkspace } from '../src/arw-tree/workspace';

test('local workspace lists nested paths, edits with conflict detection, and runs in its actual root', async t => {
  const root=await mkdtemp(join(tmpdir(),'arw-workspace-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src'));await writeFile(join(root,'src/file.txt'),'before');
  const workspace=localWorkspace(root);
  assert.equal((await workspace.list('.'))[0].directory,true);
  const file=await workspace.read('src/file.txt');
  await workspace.write('src/file.txt','after',file.hash);
  assert.equal(await readFile(join(root,'src/file.txt'),'utf8'),'after');
  await assert.rejects(workspace.write('src/file.txt','wrong',file.hash),/changed/);
  await assert.rejects(workspace.write('../outside','denied'),/outside/);
  const result=await workspace.run(process.platform==='win32'?'cd':'pwd');
  assert.equal(result.exitCode,0);assert.equal(await realpath(result.stdout.trim()),await realpath(root));
});

test('local saves keep the inode and permissions, truncate shorter contents, and create private files',async context=>{
  const root=await mkdtemp(join(tmpdir(),'arw-in-place-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const target=join(root,'file');await writeFile(target,'original long content');
  if(process.platform!=='win32')await chmod(target,0o640);
  const before=await stat(target),workspace=localWorkspace(root),original=await workspace.read('file');
  await workspace.write('file','short',original.hash);
  const after=await stat(target);
  assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);assert.equal(after.uid,before.uid);assert.equal(after.gid,before.gid);
  assert.equal(await readFile(target,'utf8'),'short');
  await workspace.write('new','');assert.equal((await stat(join(root,'new'))).size,0);
  if(process.platform!=='win32')assert.equal((await stat(join(root,'new'))).mode&0o777,0o600);
});

test('local saves preserve ordinary permissions without restoring setuid/setgid',{skip:process.platform==='win32'},async context=>{
  const root=await mkdtemp(join(tmpdir(),'arw-special-mode-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const target=join(root,'file');await writeFile(target,'original');await chmod(target,0o6751);
  const workspace=localWorkspace(root),original=await workspace.read('file');
  await workspace.write('file','new',original.hash);
  assert.equal(await readFile(target,'utf8'),'new');assert.equal((await stat(target)).mode&0o1777,0o751);
});

test('local workspace refuses binary/oversized text and symlink replacement',async t=>{
  const root=await mkdtemp(join(tmpdir(),'arw-workspace-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const workspace=localWorkspace(root);
  await writeFile(join(root,'binary'),Buffer.from([0,1]));await assert.rejects(workspace.read('binary'),/binary/);
  await writeFile(join(root,'large'),'');await truncate(join(root,'large'),500*1024*1024+1);await assert.rejects(workspace.read('large'),/500 MiB/);
  if(process.platform!=='win32'){
    await writeFile(join(root,'target'),'original');await symlink('target',join(root,'link'));
    await assert.rejects(workspace.read('link'),/symbolic/);await assert.rejects(workspace.write('link','replace'),/symbolic/);
    assert.equal(await readFile(join(root,'target'),'utf8'),'original');
  }
});

test('local file reads and listings may leave the workspace but writes cannot',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'arw-read-scope-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const root=join(directory,'project'),outside=join(directory,'shared');await mkdir(root);await mkdir(outside);
  const file=join(outside,'reference.txt');await writeFile(file,'reference');
  const workspace=localWorkspace(root);
  assert.equal((await workspace.read(file)).content,'reference');
  assert.equal((await workspace.read('../shared/reference.txt')).content,'reference');
  assert.equal((await workspace.list('../shared'))[0].name,'reference.txt');
  await assert.rejects(workspace.write(file,'denied'),/outside/);
  await assert.rejects(workspace.write('../shared/reference.txt','denied'),/outside/);
  assert.equal(await readFile(file,'utf8'),'reference');
});
