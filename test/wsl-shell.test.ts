import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { wslShellArguments } from '../src/shared/wsl-shell'

test('WSL Git and AI load the selected guest shell before running literal POSIX commands', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw guest shell '))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const shell=join(root,'guest-shell')
    await writeFile(shell,`#!/bin/sh
[ "$1" = '-l' ] || exit 90
shift
if [ "$1" = '-i' ]; then export GUEST_INTERACTIVE=yes; shift; fi
export GUEST_LOADED=yes
exec /bin/sh "$@"
`,{mode:0o755})
    for(const interactive of [false,true]){
        const command=`printf '%s\\n' "$GUEST_LOADED" "\${GUEST_INTERACTIVE:-no}" 'literal $value "quotes"'`
        const result=spawnSync('/bin/sh',wslShellArguments(command,interactive).slice(1),{
            env:{...process.env,SHELL:shell},encoding:'utf8',
        })
        assert.equal(result.status,0,result.stderr)
        assert.equal(result.stdout,`yes\n${interactive?'yes':'no'}\nliteral $value "quotes"\n`)
    }
})
