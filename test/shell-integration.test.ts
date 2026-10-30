import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cwdIntegrationCommand } from '../src/shared/shell-integration';
const execute=promisify(execFile);

test('Bash reporting emits actual OSC bytes after cd and preserves existing scalar prompt commands',async t=>{
  const root=await mkdtemp(join(tmpdir(),'arw-shell-hook-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'child'));
  const hook=cwdIntegrationCommand('bash');
  const script=`PROMPT_COMMAND='printf ORIGINAL; # keep comment'\n${hook}\ncd child\neval "$PROMPT_COMMAND"\n${hook}\nprintf '\\nCOUNT=%s' "$(printf '%s' "$PROMPT_COMMAND" | grep -o __arw_cwd | wc -l)"`;
  const result=await execute('bash',['--noprofile','--norc','-c',script],{cwd:root});
  assert.ok(result.stdout.includes(`\x1b]1337;CurrentDir=${root}\x07`));
  assert.ok(result.stdout.includes(`\x1b]1337;CurrentDir=${root}/child\x07`));
  assert.ok(result.stdout.includes('ORIGINAL'));assert.match(result.stdout,/COUNT=1$/);
  assert.equal(result.stdout.includes('\\033'),false);
});
test('Bash reporting preserves prompt arrays and does not register duplicates',async()=>{
  const hook=cwdIntegrationCommand('bash');
  const script=`PROMPT_COMMAND=('printf FIRST' 'printf SECOND')\n${hook}\n${hook}\nfor command in "\${PROMPT_COMMAND[@]}"; do eval "$command"; done\nprintf '\\nSIZE=%s' "\${#PROMPT_COMMAND[@]}"`;
  const result=await execute('bash',['--noprofile','--norc','-c',script]);
  assert.match(result.stdout,/FIRSTSECOND/);assert.match(result.stdout,/SIZE=3$/);
  assert.ok(result.stdout.includes('\x1b]1337;CurrentDir='));
});
for(const shell of ['zsh','fish'] as const){
  test(`${shell} emits cwd reports without modifying configuration files`,{skip:spawnSync(shell,['--version']).status!==0},async()=>{
    const hook=cwdIntegrationCommand(shell);
    const result=await execute(shell,[shell==='zsh'?'-f':'--no-config','-c',hook]);
    assert.ok(result.stdout.includes('\x1b]1337;CurrentDir='));
    assert.ok(result.stdout.includes('\x07'));assert.equal(result.stdout.includes('\\033'),false);
  });
}
