import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { WSL_ARW_BRIDGE, WSL_ARW_LOADER, wslBridgeEnvironment, wslUserBridgeSetup, WSL_USER_BRIDGE_MARKER } from '../src/arw-ai-cli/wsl-bridge'
import { replaceShellArguments, shellCommand } from '../src/arw-ai-cli/shell'

test('WSL receives a bridge for Windows Node and host workspace context',()=>{
    const env={Path:'C:\\missing;C:\\Program Files\\nodejs',ARW_WORKSPACE_ROOT:'/srv/project',
        TABBY_CONFIG_DIRECTORY:'C:\\Tabby config',ARW_WSL_CONTEXT:'stale',ARW_WORKSPACE_ID:'stale',ARW_TERMINAL_MODE:'1',OTHER:'do not forward'}
    const source='C:\\Tabby plugins\\manager\\dist\\arw.cjs'
    const bridge=wslBridgeEnvironment('C:\\Windows\\System32\\wsl.exe',env,source,undefined,'win32',path=>path==='C:\\Program Files\\nodejs\\node.exe')
    assert.equal(bridge.ARW_WSL_NODE,'C:\\Program Files\\nodejs\\node.exe')
    assert.equal(bridge.ARW_WSL_BIN,'C:\\Tabby plugins\\manager\\dist\\wsl-bin')
    assert.equal(bridge.ARW_WSL_CLI,source)
    assert.deepEqual(JSON.parse(bridge.ARW_WSL_CONTEXT),{ARW_WORKSPACE_ROOT:'/srv/project',TABBY_CONFIG_DIRECTORY:'C:\\Tabby config'})
    const launch=shellCommand({command:'wsl.exe',args:['-d','Ubuntu'],env:bridge,shellType:null},['codex','--model','a b'])
    assert.deepEqual(launch.args.slice(0,7),['-d','Ubuntu','--exec','bash','-l','-i','-c'])
    assert.match(launch.args.at(-1)!,/export PATH="\$__arw_bin:\$PATH"/)
    const restored=replaceShellArguments({...launch,args:launch.args},['codex','resume','--last'])
    assert.match(restored.args.at(-1)!,/export PATH="\$__arw_bin:\$PATH"/)
    assert.ok(restored.args.at(-1)!.endsWith("exec 'codex' 'resume' '--last'"))
    assert.ok(launch.args.at(-1)!.endsWith("exec 'codex' '--model' 'a b'"))
})
test('bridge is limited to Windows WSL shells and reports missing Windows Node',()=>{
    const env={PATH:'C:\\not installed'}
    assert.equal(wslBridgeEnvironment('pwsh.exe',env,'source',undefined,'win32'),env)
    assert.equal(wslBridgeEnvironment('wsl.exe',env,'source',undefined,'linux'),env)
    assert.throws(()=>wslBridgeEnvironment('wsl.exe',env,'source',undefined,'win32',()=>false),/Windows Node.js/)
})
test('bridge preserves cwd, stdin, literal arguments, context and exit status',{skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),"arw bridge 'quoted' ")),physicalRoot=await realpath(root)
    context.after(()=>rm(root,{recursive:true,force:true}))
    const bin=join(root,'bin');await mkdir(bin)
    const source=join(root,'cli.cjs'),bridge=join(root,'arw')
    await writeFile(join(bin,'wslpath'),'#!/bin/sh\nprintf "%s\\n" "$2"\n',{mode:0o755})
    await writeFile(bridge,WSL_ARW_BRIDGE,{mode:0o755})
    await writeFile(join(root,'loader.cjs'),WSL_ARW_LOADER)
    await writeFile(source,`let stdin='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>stdin+=x);process.stdin.on('end',()=>{console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),config:process.env.TABBY_CONFIG_DIRECTORY,stdin}));process.exitCode=17})`)
    const args=['--input','-',"a 'quoted' argument",'$(echo injected); echo unexpected']
    const child=execFile('/bin/sh',[bridge,...args],{cwd:root,env:{...process.env,PATH:bin+':'+process.env.PATH,
        ARW_WSL_NODE:process.execPath,ARW_WSL_LOADER:join(root,'loader.cjs'),ARW_WSL_CLI:source,ARW_WSL_CONTEXT:JSON.stringify({TABBY_CONFIG_DIRECTORY:'C:\\Tabby config'})}})
    child.stdin!.end('stdin payload')
    const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
        let output='';child.stdout!.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,output}))
    })
    assert.equal(result.code,17)
    assert.deepEqual(JSON.parse(result.output),{cwd:physicalRoot,args,config:'C:\\Tabby config',stdin:'stdin payload'})
})

test('WSL starts Bash directly so bridge variables are not expanded by an outer shell',()=>{
    const env=wslBridgeEnvironment('wsl.exe',{PATH:'C:\\nodejs'},'C:\\Users\\user\\AppData\\Roaming\\tabby\\plugins\\node_modules\\manager\\dist\\arw.cjs',undefined,'win32',()=>true)
    for(const args of [[],['--'],['-e'],['--exec']]){
        const launch=shellCommand({command:'wsl.exe',args,env,shellType:null},['codex'])
        assert.equal(launch.args[0],'--exec')
        assert.equal(launch.args[1],'bash')
        assert.ok(launch.args.at(-1)!.includes('$__arw_bin'))
        assert.ok(launch.args.at(-1)!.includes('AppData'))
    }
    const legacy=replaceShellArguments({command:'wsl.exe',args:['--','bash','-i','-c',"exec 'codex'"],env,shellType:null},['codex','resume'])
    assert.equal(legacy.args[0],'--exec')
})

test('user bridge installs cleanly, updates itself and works after a PATH snapshot reset',{skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),"arw user bridge 'quoted' "))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const home=join(root,'home'),bin=join(root,'bin'),source=join(root,'installed-cli.cjs'),loader=join(root,'loader.cjs')
    await mkdir(join(home,'.local','bin'),{recursive:true});await mkdir(bin)
    const command=join(home,'.local','bin','arw')
    await writeFile(join(bin,'wslpath'),'#!/bin/sh\nprintf "%s\\n" "$2"\n',{mode:0o755})
    await writeFile(loader,WSL_ARW_LOADER)
    await writeFile(source,'console.log(JSON.stringify({args:process.argv.slice(2),config:process.env.TABBY_CONFIG_DIRECTORY,workspace:process.env.ARW_WORKSPACE_ROOT}))')
    const setup=wslUserBridgeSetup({ARW_WSL_NODE:process.execPath,ARW_WSL_LOADER:loader,ARW_WSL_CLI:source,
        ARW_WSL_CONTEXT:JSON.stringify({TABBY_CONFIG_DIRECTORY:'C:\\Tabby config',ARW_WORKSPACE_ROOT:'/private/session-only-root'})})
    const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('ARW_')))
    const env={...clean,HOME:home,PATH:bin+':'+process.env.PATH}
    const execute=(await import('node:util')).promisify(execFile)
    await execute('/bin/bash',['--noprofile','--norc','-c',setup],{env})
    assert.equal((await lstat(command)).isSymbolicLink(),false)
    assert.ok((await readFile(command,'utf8')).includes(WSL_USER_BRIDGE_MARKER))
    assert.equal((await readFile(command,'utf8')).includes('/private/session-only-root'),false)
    await execute('/bin/bash',['--noprofile','--norc','-c',setup],{env})
    const result=await execute('/bin/bash',['--noprofile','--norc','-c','arw read "a b"'],{cwd:root,env:{...env,PATH:join(home,'.local','bin')+':'+env.PATH}})
    assert.deepEqual(JSON.parse(result.stdout),{args:['read','a b'],config:'C:\\Tabby config'})
})
test('user bridge preserves existing files and never migrates legacy symlinks',{skip:process.platform==='win32'},async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw foreign '));context.after(()=>rm(home,{recursive:true,force:true}))
    const bin=join(home,'.local','bin');await mkdir(bin,{recursive:true})
    const command=join(bin,'arw'),target=join(home,'dist','arw.cjs')
    const setup=wslUserBridgeSetup({ARW_WSL_NODE:'node.exe',ARW_WSL_CLI:'arw.cjs',ARW_WSL_LOADER:'loader.cjs',ARW_WSL_CONTEXT:'{}'})
    const execute=(await import('node:util')).promisify(execFile)
    const run=()=>execute('/bin/bash',['--noprofile','--norc','-c',setup],{env:{...process.env,HOME:home}})
    await writeFile(command,'foreign command')
    await assert.rejects(run(),/belongs to another program/)
    assert.equal(await readFile(command,'utf8'),'foreign command')
    await rm(command);await mkdir(join(home,'dist'))
    await writeFile(join(home,'package.json'),JSON.stringify({name:'tabby-ai-workspace-manager'}))
    await writeFile(target,'legacy CLI');await symlink(target,command)
    await assert.rejects(run(),/belongs to another program/)
    assert.equal((await lstat(command)).isSymbolicLink(),true)
    assert.equal(await readFile(target,'utf8'),'legacy CLI')
})
