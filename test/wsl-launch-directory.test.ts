import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wslLaunchDirectory, wslDirectoryArguments, wslDirectorySetup } from '../src/shared/wsl-launch-directory'
import { shellCommand } from '../src/arw-ai-cli/shell'
import { wslBridgeEnvironment } from '../src/arw-ai-cli/wsl-bridge'

const root='\\\\wsl.localhost\\Ubuntu-24.04\\home\\julyan'
test('WSL Linux filesystem UNC paths keep native directories without selecting a distro',()=>{
    for(const host of ['wsl.localhost','wsl$']){
        assert.deepEqual(wslLaunchDirectory(`\\\\${host}\\Ubuntu-24.04\\home\\julyan`),{distribution:'Ubuntu-24.04',directory:'/home/julyan',native:true})
    }
    assert.deepEqual(wslDirectoryArguments(['-d','Ubuntu','--cd','~','--user','julyan'],root),
        ['-d','Ubuntu','--user','julyan','--cd','/home/julyan'])
    assert.equal(wslDirectorySetup(root),"cd -- '/home/julyan' || exit; ")
})
test('Windows disks retain Windows paths while WSL mount paths remain native',()=>{
    assert.deepEqual(wslDirectoryArguments(['-d','Ubuntu-24.04'],'D:\\projects'),['-d','Ubuntu-24.04','--cd','D:\\projects'])
    assert.equal(wslDirectorySetup('D:\\projects'),`cd -- "$(wslpath -u 'D:\\projects')" || exit; `)
    assert.deepEqual(wslDirectoryArguments([],'/mnt/d/projects'),['--cd','/mnt/d/projects'])
    assert.equal(wslDirectorySetup('/mnt/d/projects'),"cd -- '/mnt/d/projects' || exit; ")
})
test('startup flags precede command delimiters and stale directory options are replaced',()=>{
    for(const marker of ['--','--exec','-e']){
        assert.deepEqual(wslDirectoryArguments(['--distribution=Ubuntu','--cd=~',marker],root),
            ['--distribution=Ubuntu','--cd','/home/julyan',marker])
    }
    assert.deepEqual(wslDirectoryArguments([],root.slice(0,root.indexOf('\\home'))),['--cd','/'])
    assert.throws(()=>wslLaunchDirectory('relative/path'),/absolute/)
})
test('WSL AI launch explicitly uses the selected workspace rather than the host cwd',()=>{
    const env=wslBridgeEnvironment('wsl.exe',{PATH:'C:\\nodejs'},'C:\\plugin\\dist\\arw.cjs',root,'win32',()=>true)
    const launch=shellCommand({command:'wsl.exe',args:[],env,shellType:null},['codex'])
    assert.deepEqual(launch.args.slice(0,7),['--cd','/home/julyan','--exec','bash','-l','-i','-c'])
    assert.ok(launch.args.at(-1)!.startsWith("cd -- '/home/julyan' || exit; "))
    assert.equal(env.ARW_WSL_CWD,root)
})
test('workspace is restored after a login profile changes directory',{skip:process.platform==='win32'},async context=>{
    const directory=await mkdtemp(join(tmpdir(),"arw cwd 'quoted' "))
    context.after(()=>rm(directory,{recursive:true,force:true}))
    const result=await promisify(execFile)('/bin/bash',['--noprofile','--norc','-c',`cd /; ${wslDirectorySetup(directory)}pwd -P`])
    const expected=await promisify(execFile)('/bin/bash',['--noprofile','--norc','-c',`pwd -P`],{cwd:directory})
    assert.equal(result.stdout,expected.stdout)
})
