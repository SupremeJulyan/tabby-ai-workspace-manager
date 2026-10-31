import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeChannel, type ExecChannel } from '../src/shared/exec-channel';
class Events<T> {
  listeners = new Set<{ next(value: T): void }>();
  subscribe(observer: { next(value: T): void }) {
    this.listeners.add(observer);
    return { unsubscribe: () => this.listeners.delete(observer) };
  }
  emit(value: T) { for (const observer of this.listeners) observer.next(value); }
}
function channel(shell='/bin/sh',args=['-c'],prefix=''): ExecChannel {
  const data$ = new Events<Uint8Array>(), extendedData$ = new Events<[number, Uint8Array]>();
  const closed$ = new Events<void>();
  let child: ReturnType<typeof spawn> | undefined;
  return { data$, extendedData$, closed$,
    async requestExec(command) {
      child = spawn(shell, [...args, prefix+command]);
      child.stdout!.on('data', chunk => {
        for (const byte of chunk) data$.emit(Buffer.from([byte]));
      });
      child.stderr!.on('data', chunk => extendedData$.emit([1, chunk]));
      child.on('close', () => closed$.emit());
    },
    async write(bytes) { await new Promise<void>((resolve,reject)=>child!.stdin!.write(bytes,error=>error?reject(error):resolve())); },
    async eof() { child?.stdin?.end(); },
    async close() { child?.kill(); }
  };
}
test('exec preserves split UTF-8, NUL output, stderr, and nonzero exit status', async () => {
  const result = await executeChannel(channel(), "printf '中文\\000末尾'; printf error >&2; exit 17", '/tmp');
  assert.equal(result.exitCode, 17);
  assert.equal(result.stdout, '中文\0末尾');
  assert.equal(result.stderr, 'error');
});
test('exec never runs in another directory when cwd is missing', async () => {
  const result = await executeChannel(channel(), 'printf first; printf should-not-run', '/does-not-exist-arw');
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, '');
});
test('exec treats a dropped channel as unknown, not success', async () => {
  const remote = channel();
  remote.requestExec = async () => { (remote.closed$ as Events<void>).emit(); };
  await assert.rejects(executeChannel(remote, 'true', '/tmp'), /状态未知/);
});
test('exec bounds output and rejects pre-cancelled requests', async () => {
  await assert.rejects(executeChannel(channel(), "printf '123456789'", '/tmp', { maxBytes: 4 }), /输出超过限制/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeChannel(channel(), 'true', '/tmp', { signal: controller.signal }), /取消/);
});

test('exec streams input in chunks instead of embedding contents in the remote command',async()=>{
  const input=Buffer.from('中文\0'.repeat(20000));
  const result=await executeChannel(channel(),'wc -c','/tmp',{input});
  assert.equal(result.exitCode,0);
  assert.equal(Number(result.stdout.trim()),input.length);
  assert.equal((await executeChannel(channel(),'wc -c','/tmp',{input:Buffer.alloc(0)})).stdout.trim(),'0');
});

test('exec waits for a split ready marker before streaming input',async()=>{
  const remote=channel(),write=remote.write!.bind(remote);
  let ready=false,written=0;
  remote.write=async bytes=>{assert.equal(ready,true);written+=bytes.length;await write(bytes)};
  const input=Buffer.from('payload');
  const result=await executeChannel(remote,"printf 'RE'; printf 'ADY'; wc -c",'/tmp',{
    input,inputReadyMarker:'READY',onStdout:output=>{if(output.includes('READY'))ready=true},
  });
  assert.equal(result.exitCode,0);assert.equal(written,input.length);
  assert.equal(result.stdout,'READY7\n');
});

test('exec returns preflight rejection without uploading or hanging on readiness',async()=>{
  const remote=channel();
  remote.write=async()=>{throw Error('Input must not be sent')};
  const result=await executeChannel(remote,'printf conflict >&2; exit 9','/tmp',{
    input:Buffer.alloc(1024*1024),inputReadyMarker:'READY',timeoutMs:1000,
  });
  assert.equal(result.exitCode,9);assert.equal(result.stderr,'conflict');
});

test('exec aborts cleanly while waiting for readiness',async()=>{
  const remote=channel(),controller=new AbortController();
  remote.requestExec=async()=>{};
  let writes=0;
  remote.write=async()=>{writes++};
  const pending=executeChannel(remote,'true','/tmp',{
    input:Buffer.from('payload'),inputReadyMarker:'READY',signal:controller.signal,
  });
  controller.abort();
  await assert.rejects(pending,/取消/);
  assert.equal(writes,0);
});

test('exec transport is a single line and a login-shell exit trap cannot corrupt the trailer',async()=>{
  const remote=channel('/bin/bash',['--noprofile','--norc','-c'],"trap 'printf UNWANTED_LOGOUT' EXIT; "),request=remote.requestExec.bind(remote);
  remote.requestExec=async script=>{
    assert.ok(script.startsWith('exec /bin/sh -c '));
    assert.equal(script.includes('\n'),false);
    await request(script);
  };
  const result=await executeChannel(remote,"printf first; # comment\nprintf second; exit 23",'/tmp');
  assert.equal(result.stdout,'firstsecond');assert.equal(result.exitCode,23);
});
for(const [shell,args] of [['tcsh',['-f','-c']],['fish',['--no-config','-c']]] as const){
  test(`exec works through a ${shell} login shell with multiline commands and quoted cwd`,{skip:spawnSync(shell,['--version']).status!==0},async context=>{
    const root=await mkdtemp(join(tmpdir(),"arw exec 'quoted' ! 中文 "));
    context.after(()=>rm(root,{recursive:true,force:true}));
    const result=await executeChannel(channel(shell,[...args]),"printf '中文 ! first\\n'; # comment\nprintf second; printf remote-error >&2; exit 19",root);
    assert.equal(result.stdout,'中文 ! first\nsecond');assert.equal(result.exitCode,19);assert.ok(result.stderr.includes('remote-error'));
  });
}
test('missing completion reports bounded redacted stderr without exposing command stdout or retrying',async()=>{
  const remote=channel();let requests=0;
  remote.requestExec=async()=>{
    requests++;
    (remote.data$ as Events<Uint8Array>).emit(Buffer.from('private stdout'));
    (remote.extendedData$ as Events<[number,Uint8Array]>).emit([1,Buffer.from('exec denied\nAuthorization: Bearer arw-sensitive-value\n'+'x'.repeat(3000))]);
    (remote.closed$ as Events<void>).emit();
  };
  await assert.rejects(executeChannel(remote,'true','/tmp'),error=>{
    const message=String(error);
    assert.match(message,/状态未知/);assert.match(message,/stdout=14 B/);assert.match(message,/exec denied/);
    assert.equal(message.includes('private stdout'),false);assert.equal(message.includes('arw-sensitive-value'),false);assert.ok(message.length<1500);
    return true;
  });
  assert.equal(requests,1);
});

test('exec completion survives an inner exec replacement and command syntax errors',async()=>{
  const replaced=await executeChannel(channel(),'exec printf replaced','/tmp');
  assert.equal(replaced.stdout,'replaced');assert.equal(replaced.exitCode,0);
  const invalid=await executeChannel(channel(),'printf should-not-run; (','/tmp');
  assert.notEqual(invalid.exitCode,0);assert.equal(invalid.stdout,'');assert.ok(invalid.stderr);
})


test('exec drains remote rejection after stdin EPIPE and never accepts a truncated successful upload',async()=>{
  const rejected=channel();
  rejected.write=async()=>{throw Object.assign(new Error('write EPIPE'),{code:'EPIPE'})};
  const result=await executeChannel(rejected,'sleep 0.02; printf "writer failed" >&2; exit 1','/tmp',{input:Buffer.from('payload'),timeoutMs:1000});
  assert.equal(result.exitCode,1);assert.equal(result.stderr,'writer failed');
  const incomplete=channel();
  incomplete.write=rejected.write;
  await assert.rejects(executeChannel(incomplete,'sleep 0.02; true','/tmp',{input:Buffer.from('payload'),timeoutMs:1000}),/EPIPE/);
});
