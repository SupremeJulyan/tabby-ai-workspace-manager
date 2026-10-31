import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { relayGit, type RelayTransport } from '../src/arw-tree/git/git-relay';
import { localGitRunner } from '../src/arw-tree/git/local-git-push';
import { execGitFixture as exec } from './git-fixture-exec';
test('desktop relay orchestrates pull and push over bundle transport', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arw-desktop-relay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream.git'), seed = path.join(root, 'seed');
  const remote = path.join(root, 'remote'), storagePath = path.join(root, 'cache');
  const git = localGitRunner();
  await git(['init', '--bare', '-b', 'main', upstream]);
  await git(['clone', upstream, seed]);
  for (const [key, value] of [['user.name', 'Relay Test'], ['user.email', 'relay@example.test']]) {
    await git(['-C', seed, 'config', key, value]);
  }
  await writeFile(path.join(seed, 'file'), 'one');
  await git(['-C', seed, 'add', '.']); await git(['-C', seed, 'commit', '-m', 'one']);
  await git(['-C', seed, 'push', 'origin', 'main']);
  await git(['clone', upstream, remote]);
  await git(['-C', remote, 'remote', 'set-url', 'origin', 'https://example.test/project.git']);
  const transport: RelayTransport = {
    root: remote,
    async run(command) {
      try { return { ...await exec('/bin/sh', ['-c', command], { cwd: remote }), exitCode: 0 }; }
      catch (error) { const result = error as { code: number; stdout: string; stderr: string };
        return { ...result, exitCode: result.code }; }
    },
    async download(source, destination) { await copyFile(source, destination); },
    async upload(source, destination) { await copyFile(source, destination); },
    async remove(file) { await rm(file, { force: true }); }
  };
  const local: typeof git = (args, signal, report) => git(args.map(arg =>
    arg === 'https://example.test/project.git' ? upstream : arg), signal, report);
  await writeFile(path.join(seed, 'file'), 'two');
  await git(['-C', seed, 'commit', '-am', 'two']); await git(['-C', seed, 'push', 'origin', 'main']);
  await writeFile(path.join(remote,'file'),'uncommitted local edit');
  assert.equal((await relayGit('fetch',transport,{storagePath,local}))?.status,'fetched');
  assert.equal(await git(['-C',remote,'show','HEAD:file']),'one','fetch must not move HEAD');
  assert.equal(await readFile(path.join(remote,'file'),'utf8'),'uncommitted local edit','fetch must preserve dirty files');
  assert.equal(await git(['-C',remote,'show','origin/main:file']),'two');
  assert.equal((await relayGit('fetch',transport,{storagePath,local}))?.status,'up-to-date');
  await writeFile(path.join(remote,'file'),'one');
  assert.equal((await relayGit('pull', transport, { storagePath, local }))?.status, 'merged');
  assert.equal(await git(['-C', remote, 'show', 'HEAD:file']), 'two');
  for (const [key, value] of [['user.name', 'Relay Test'], ['user.email', 'relay@example.test']]) {
    await git(['-C', remote, 'config', key, value]);
  }
  await writeFile(path.join(remote, 'file'), 'three'); await git(['-C', remote, 'commit', '-am', 'three']);
  await relayGit('push', transport, { storagePath, local });
  assert.equal(await git(['-C', upstream, 'show', 'main:file']), 'three');
  assert.deepEqual((await readdir(path.join(remote, '.git'))).filter(name => name.startsWith('arw-')), []);
});
