import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { installUserCli, uninstallUserCli } from '../src/arw-ai-cli/cli-lifecycle'
import { windowsCliFiles, windowsUserPath } from '../src/arw-ai-cli/windows-cli'

test('Windows CLI uses an ASCII shim and Unicode-safe Node launcher, manages only its own user PATH entry',async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw win 用户 '));context.after(()=>rm(home,{recursive:true,force:true}))
    const source=join(home,"source % & ' 名.cjs")
    await writeFile(source,'console.log("ready")')
    let path='%SystemRoot%\\system32;C:\\Other',writes=0
    const options={platform:'win32' as const,userPath:{async read(){return path},async write(value:string){path=value;writes++}}}
    await installUserCli(source,home,'',options);await installUserCli(source,home,'',options)
    const files=[...windowsCliFiles(source,home).keys()],directory=dirname(files[0])
    assert.equal(writes,1);assert.equal(path,`%SystemRoot%\\system32;C:\\Other;${directory}`)
    assert.match(await readFile(files[0],'utf8'),/%~dp0arw-launcher.cjs/)
    assert.ok(/^[\x00-\x7f]*$/.test(await readFile(files[0],'utf8')))
    const executed=await promisify(execFile)(process.execPath,[files[1]],{encoding:'utf8'})
    assert.equal(executed.stdout.trim(),'ready')
    path+=';C:\\AddedLater'
    await uninstallUserCli(source,home,options)
    assert.equal(path,'%SystemRoot%\\system32;C:\\Other;C:\\AddedLater')
    for(const file of files)await assert.rejects(readFile(file))
})

test('Windows CLI preserves existing PATH entries and foreign or replaced shims',async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw-win-owned-'));context.after(()=>rm(home,{recursive:true,force:true}))
    const source=join(home,'source.cjs'),files=[...windowsCliFiles(source,home).keys()],directory=dirname(files[0])
    let path=directory.toUpperCase(),writes=0
    const options={platform:'win32' as const,userPath:{async read(){return path},async write(value:string){path=value;writes++}}}
    await installUserCli(source,home,'',options)
    await uninstallUserCli(source,home,options)
    assert.equal(writes,0);assert.equal(path,directory.toUpperCase())
    await mkdir(directory,{recursive:true});await writeFile(files[0],'foreign')
    await assert.rejects(installUserCli(source,home,'',options),/未覆盖/)
    assert.equal(await readFile(files[0],'utf8'),'foreign')
    await rm(files[0]);await installUserCli(source,home,'',options)
    await writeFile(files[0],'replaced')
    await uninstallUserCli(source,home,options)
    assert.equal(await readFile(files[0],'utf8'),'replaced');assert.equal(writes,0)
})

test('Windows PATH update failure is retryable without duplicate entries',async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw-win-retry-'));context.after(()=>rm(home,{recursive:true,force:true}))
    const source=join(home,'source.cjs');let path='',fail=true
    const options={platform:'win32' as const,userPath:{async read(){return path},async write(value:string){if(fail)throw new Error('denied');path=value}}}
    await assert.rejects(installUserCli(source,home,'',options),/denied/)
    fail=false;await installUserCli(source,home,'',options);await uninstallUserCli(source,home,options)
    assert.equal(path,'')
})

test('Windows command shim runs through cmd.exe with spaced Unicode paths and literal arguments',{skip:process.platform!=='win32'},async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw cli 名 '));context.after(()=>rm(home,{recursive:true,force:true}))
    const source=join(home,'source % name.cjs')
    await writeFile(source,'console.log(JSON.stringify(process.argv.slice(2)))')
    const options={platform:'win32' as const,userPath:{async read(){return ''},async write(){}}}
    await installUserCli(source,home,'',options)
    const command=[...windowsCliFiles(source,home).keys()][0]
    const result=await promisify(execFile)('cmd.exe',['/d','/s','/c',`""${command}" "two words" "a&b""`],{windowsVerbatimArguments:true,encoding:'utf8'})
    assert.deepEqual(JSON.parse(result.stdout.trim()),['two words','a&b'])
})

test('Windows CI exercises the real user PATH registry adapter without expanding stored variables',{skip:process.platform!=='win32'||process.env.CI!=='true'},async()=>{
    const previous=await windowsUserPath.read()
    try{
        const value=previous+';%SystemRoot%\\System32'
        await windowsUserPath.write(value)
        assert.equal(await windowsUserPath.read(),value)
    }finally{await windowsUserPath.write(previous)}
})
