import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { truncate, mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, chmod, chown, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subject } from 'rxjs'
import { remoteWorkspace } from '../src/adapters/remote-workspace'
import { optionalSftp } from '../src/adapters/optional-sftp'
import { parseShellDirectory } from '../src/adapters/shell-files'
import { sftpFixture } from './sftp-copy-fixture'
import { textHash } from '../src/arw-tree/workspace'
import { statSync, readdirSync } from 'node:fs'

function sessionFixture (cwd:string, beforeCommand?:(command:string)=>Promise<void>, env=process.env) {
    let opens=0
    const commands:string[]=[]
    const hooks:{rewrite?:(command:string)=>string;afterInput?:()=>Promise<void>}={}
    const session={open:true,profile:{options:{host:'no-sftp-fixture'}},
        ssh:{async openSessionChannel(){return {}},async activateChannel(){
            const data$=new Subject<Buffer>(),extendedData$=new Subject<[number,Buffer]>(),closed$=new Subject<void>()
            let child:ReturnType<typeof spawn>|undefined
            return {data$,extendedData$,closed$,async requestExec(command:string){
                commands.push(command)
                await beforeCommand?.(command)
                child=spawn('/bin/sh',['-c',hooks.rewrite?.(command)??command],{cwd,env:{...env,LC_ALL:'C'}})
                // write() reports pipe failures through its callback; consume the matching stream event.
                child.stdin!.on('error',()=>{})
                child.stdout!.on('data',chunk=>data$.next(chunk))
                child.stderr!.on('data',chunk=>extendedData$.next([1,chunk]))
                child.on('close',()=>closed$.next())
                child.on('error',error=>closed$.error(error))
            },async write(bytes:Uint8Array){
                await new Promise<void>((resolve,reject)=>child!.stdin!.write(bytes,error=>error?reject(error):resolve()))
                await hooks.afterInput?.()
            },async eof(){child?.stdin?.end()},async close(){child?.stdin?.end();child?.kill()}}
        }},
        async openSFTP():Promise<any>{opens++;throw new Error('subsystem request failed')},
    }
    return {session,commands,hooks,get opens(){return opens}}
}

test('SFTP saves ignore missing or invalid SFTP modes and verify actual metadata before writing', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-sftp-mode-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'script.sh')
    const modes=[0,undefined,null,NaN,-1,Infinity,0.5,0o100000,0o100751]
    for(const mode of modes){
        await writeFile(target,'before');await chmod(target,0o751)
        const fixture=sessionFixture(root),sftp=sftpFixture()
        const originalStat=sftp.stat.bind(sftp)
        sftp.stat=async path=>({...await originalStat(path),mode:mode as number})
        fixture.session.openSFTP=async()=>sftp
        const workspace=remoteWorkspace(fixture.session as any,root)
        await workspace.write('script.sh','after')
        assert.equal(await readFile(target,'utf8'),'after')
        assert.equal((await stat(target)).mode&0o777,0o751,`reported mode: ${mode}`)
        assert.ok(fixture.commands.every(command=>!command.includes('--preserve=mode,ownership,xattr')),'in-place saves never copy file attributes')
    }
    await writeFile(target,'unchanged');await chmod(target,0o751)
    const fixture=sessionFixture(root,async command=>{
        if(command.includes('stat -c'))throw new Error('stat unavailable')
    }),sftp=sftpFixture()
    fixture.session.openSFTP=async()=>sftp
    await assert.rejects(remoteWorkspace(fixture.session as any,root).write('script.sh','unsafe'),/stat unavailable/)
    assert.equal(await readFile(target,'utf8'),'unchanged')
    assert.equal((await stat(target)).mode&0o777,0o751)
    assert.deepEqual(await readdir(root),['script.sh'])
})

test('SFTP and shell saves preserve ordinary and setuid/setgid permissions', {skip:process.platform!=='linux'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-metadata-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file'),group=process.getgroups?.().find(group=>group!==process.getgid?.())
    for(const withSftp of [false,true]){
        for(const mode of [0o000,0o600,0o640,0o751,0o1751,0o2751,0o4751,0o6751]){
            await writeFile(target,'before');if(group!==undefined)await chown(target,process.getuid!(),group)
            await chmod(target,mode)
            const before=await stat(target),fixture=sessionFixture(root)
            if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
            if(mode&0o6000){
                const workspace=remoteWorkspace(fixture.session as any,root)
                await workspace.write('file','after')
            }
            if(mode===0o000&&process.getuid?.()!==0){
                await assert.rejects(remoteWorkspace(fixture.session as any,root).write('file','after'),/permission denied/i)
                assert.equal((await stat(target)).mode&0o7777,0o000)
                await chmod(target,0o600);assert.equal(await readFile(target,'utf8'),'before')
                continue
            }
            await remoteWorkspace(fixture.session as any,root).write('file','after')
            const after=await stat(target)
            assert.equal(after.mode&0o7777,before.mode&0o7777,`SFTP=${withSftp}, mode=${mode.toString(8)}`)
            assert.equal(after.uid,before.uid);assert.equal(after.gid,before.gid)
            await chmod(target,0o600)
            assert.equal(await readFile(target,'utf8'),'after')
        }
    }
})

test('SFTP reads text above the old limit and rejects files over 500 MiB', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-sftp-size-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const fixture=sessionFixture(root);fixture.session.openSFTP=async()=>sftpFixture()
    const workspace=remoteWorkspace(fixture.session as any,root)
    const text='x'.repeat(11*1024*1024)
    await writeFile(join(root,'large'),text)
    assert.equal((await workspace.read('large')).content,text)
    await truncate(join(root,'large'),500*1024*1024+1)
    await assert.rejects(workspace.read('large'),/500 MiB/)
})

test('SFTP and shell saves preserve extended ACLs and xattrs, including inherited ACL directories', {skip:process.platform!=='linux'}, async context=>{
    for(const executable of ['setfacl','getfacl','setfattr','getfattr']){
        try{execFileSync(executable,['--version'],{stdio:'ignore'})}catch{context.skip(`${executable} unavailable`);return}
    }
    const root=await mkdtemp(join(tmpdir(),'arw-save-acl-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file')
    execFileSync('setfacl',['-m','d:u:65534:rwx',root])
    for(const withSftp of [false,true]){
        await rm(target,{force:true});await writeFile(target,'before')
        execFileSync('setfacl',['-m','u:65534:r--,m::r--',target])
        execFileSync('setfattr',['-n','user.arw-test','-v','preserve me',target])
        const before=execFileSync('getfacl',['-cpn',target],{encoding:'utf8'})
        const fixture=sessionFixture(root)
        if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
        await remoteWorkspace(fixture.session as any,root).write('file','after')
        assert.equal(execFileSync('getfacl',['-cpn',target]).toString(),before)
        assert.equal(execFileSync('getfattr',['--only-values','-n','user.arw-test',target],{stdio:['ignore','pipe','ignore']}).toString(),'preserve me')
        assert.equal(await readFile(target,'utf8'),'after')
    }
})

test('in-place saves do not stage or copy file attributes', {skip:process.platform!=='linux'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-in-place-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file')
    for(const withSftp of [false,true]){
        await writeFile(target,'before');await chmod(target,0o751)
        const fixture=sessionFixture(root)
        if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
        await remoteWorkspace(fixture.session as any,root).write('file','after')
        assert.equal(await readFile(target,'utf8'),'after');assert.equal((await stat(target)).mode&0o7777,0o751)
        assert.ok(fixture.commands.every(command=>!command.includes('cp --attributes-only')))
        assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
    }
})

test('remote in-place saves refuse hard links', {skip:process.platform!=='linux'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-hardlink-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file');await writeFile(target,'before');await link(target,join(root,'alias'))
    for(const withSftp of [false,true]){
        const fixture=sessionFixture(root)
        if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
        await assert.rejects(remoteWorkspace(fixture.session as any,root).write('file','after'),/hard-linked/)
        assert.equal(await readFile(target,'utf8'),'before');assert.equal(await readFile(join(root,'alias'),'utf8'),'before')
        assert.equal((await stat(target)).nlink,2)
    }
})

test('in-place saves leave ACLs and xattrs alone without creating staging files', {skip:process.platform!=='linux'}, async context=>{
    try{execFileSync('setfacl',['--version'],{stdio:'ignore'})}catch{context.skip('setfacl unavailable');return}
    const root=await mkdtemp(join(tmpdir(),'arw-save-metadata-race-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file')
    for(const withSftp of [false,true]){
        await writeFile(target,'before');await chmod(target,0o640)
        execFileSync('setfacl',['-m','u:65534:r--,m::r--',target])
        const before=execFileSync('getfacl',['-cpn',target],{encoding:'utf8'})
        const fixture=sessionFixture(root)
        if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
        await remoteWorkspace(fixture.session as any,root).write('file','after')
        assert.equal(await readFile(target,'utf8'),'after')
        assert.equal(execFileSync('getfacl',['-cpn',target]).toString(),before)
        assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
    }
})

test('in-place saves reject permission changes detected before writing', {skip:process.platform!=='linux'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-chmod-race-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file');await writeFile(target,'before');await chmod(target,0o751)
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    const original=await workspace.read('file')
    fixture.hooks.rewrite=command=>command.replace('test "$(_arw_stat)" = "$_arw_before"',`chmod 640 ${target}; test "$(_arw_stat)" = "$_arw_before"`)
    await assert.rejects(workspace.write('file','after',original.hash),/保存前发生了变化/)
    assert.equal(workspace.saveIssue?.('file'),undefined)
    assert.equal((await stat(target)).mode&0o7777,0o640)
    assert.equal(await readFile(target,'utf8'),'before')
})

test('SSH disconnect marks a streamed write and requires explicit verification', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-disconnect-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file');await writeFile(target,'original');await chmod(target,0o640)
    const fixture=sessionFixture(root),disconnected=new Subject<void>()
    const session={...fixture.session,profile:{id:root,options:{host:'disconnect-fixture'}},willDestroy$:disconnected}
    let release!:()=>void,markStarted!:()=>void
    const blocked=new Promise<void>(resolve=>{release=resolve}),writing=new Promise<void>(resolve=>{markStarted=resolve})
    fixture.hooks.afterInput=async()=>{markStarted();await blocked}
    const workspace=remoteWorkspace(session as any,root),original=await workspace.read('file')
    const failed=assert.rejects(workspace.write('file','saved content',original.hash),/断开/)
    await writing;session.open=false;disconnected.next();await failed
    assert.ok(workspace.saveIssue?.('file'))
    const another=remoteWorkspace(session as any,root)
    await assert.rejects(another.write('./file','retry'),/尚未确认/)
    release();fixture.hooks.afterInput=undefined
    const replacement={...session,open:true,willDestroy$:new Subject<void>()}
    const reconnected=remoteWorkspace(replacement as any,root)
    assert.ok(reconnected.saveIssue?.('file'))
    for(let attempt=0;attempt<100&&(await readFile(target,'utf8'))!=='saved content';attempt++)await new Promise(resolve=>setTimeout(resolve,5))
    const verified=await reconnected.verifySave!('file')
    assert.equal(verified.content,'saved content')
    assert.equal(workspace.saveIssue?.('file'),undefined)
    assert.equal(another.saveIssue?.('./file'),undefined)
    assert.equal(disconnected.observed,false)
})

test('in-place saves do not need ACL tools because extended ACLs remain on the same inode', {skip:process.platform!=='linux'}, async context=>{
    try{execFileSync('setfacl',['--version'],{stdio:'ignore'})}catch{context.skip('setfacl unavailable');return}
    const root=await mkdtemp(join(tmpdir(),'arw-save-no-acl-tools-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const commands=join(root,'commands');await mkdir(commands)
    for(const executable of ['realpath','stat','cp','ls','mv','rm','chmod','sh','base64','wc','sha256sum','cat','dd']){
        const source=execFileSync('/bin/sh',['-c',`command -v ${executable}`],{encoding:'utf8'}).trim()
        await symlink(source,join(commands,executable))
    }
    const target=join(root,'file')
    for(const withSftp of [false,true]){
        await rm(target,{force:true});await writeFile(target,'before');await chmod(target,0o640)
        const fixture=sessionFixture(root,undefined,{...process.env,PATH:commands})
        if(withSftp)fixture.session.openSFTP=async()=>sftpFixture()
        const workspace=remoteWorkspace(fixture.session as any,root),original=await workspace.read('file')
        await workspace.write('file','ordinary save',original.hash)
        assert.equal(await readFile(target,'utf8'),'ordinary save')
        execFileSync('setfacl',['-m','u:65534:r--',target])
        const aclBefore=execFileSync('getfacl',['-cpn',target],{encoding:'utf8'})
        await workspace.write('file','ACL-safe in-place save',textHash('ordinary save'))
        assert.equal(await readFile(target,'utf8'),'ACL-safe in-place save')
        assert.equal(execFileSync('getfacl',['-cpn',target],{encoding:'utf8'}),aclBefore)
        assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
    }
})

test('ordinary saves use one SSH channel and never reread content through SFTP', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-sftp-save-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'private.txt');await writeFile(target,'before');await chmod(target,0o600)
    const fixture=sessionFixture(root),sftp=sftpFixture()
    fixture.session.openSFTP=async()=>sftp
    const workspace=remoteWorkspace(fixture.session as any,root),before=await workspace.read('private.txt')
    await chmod(target,0o640)
    sftp.open=async()=>{throw Error('Save must not use SFTP')}
    sftp.stat=async()=>{throw Error('Save must not stat through SFTP')}
    fixture.commands.length=0
    const saved=await workspace.write('private.txt','after',before.hash)
    assert.equal(saved.content,'after');assert.equal(await readFile(target,'utf8'),'after')
    assert.equal(fixture.commands.length,1)
    assert.equal((await stat(target)).mode&0o777,0o640)
    await assert.rejects(workspace.write('private.txt','stale',before.hash),/远端文件已变化|Remote file has changed/)
    assert.equal(workspace.saveIssue?.('private.txt'),undefined)
    assert.equal(await readFile(target,'utf8'),'after')
})

test('shell directory framing preserves filenames and rejects malformed or injected records',()=>{
    const files=parseShellDirectory('ARW_DIRECTORY_V1\0f\0sp ace\0d\0中文\0l\0broken link\0','sub')
    assert.equal(files[0].name,'中文');assert.equal(files[0].directory,true)
    assert.ok(files.some(file=>file.path==='sub/broken link'&&file.symlink))
    assert.throws(()=>parseShellDirectory('banner\nARW_DIRECTORY_V1\0','.'),/不完整/)
    assert.throws(()=>parseShellDirectory('ARW_DIRECTORY_V1\0f\0name','.'),/不完整/)
    for(const name of ['..','a/b','.'])assert.throws(()=>parseShellDirectory(`ARW_DIRECTORY_V1\0f\0${name}\0`,'.'),/无效/)
    assert.throws(()=>parseShellDirectory('ARW_DIRECTORY_V1\0f\0same\0f\0same\0','.'),/无效/)
})

test('SSH without SFTP lists hidden directories, quotes paths and safely reads and writes text', {skip:process.platform==='win32'}, async context=>{
    const directory=await mkdtemp(join(tmpdir(),'arw-shell-files-'))
    context.after(()=>rm(directory,{recursive:true,force:true}))
    const root=join(directory,"root ' $(touch injected)"),outside=join(directory,'outside')
    await mkdir(root);await mkdir(outside);await mkdir(join(root,'nested'));await mkdir(join(root,'.hidden'))
    await writeFile(join(root,'nested','sp ace.txt'),'中文内容\n')
    await writeFile(join(root,'.config'),'hidden')
    await writeFile(join(outside,'secret'),'outside')
    await symlink(outside,join(root,'escape'))
    await symlink(join(root,'missing'),join(root,'broken'))
    const fixture=sessionFixture(directory),workspace=remoteWorkspace(fixture.session as any,root)
    const files=await workspace.list('.')
    assert.ok(files.some(file=>file.name==='.hidden'&&file.directory))
    assert.ok(files.some(file=>file.name==='.config'&&!file.directory))
    assert.ok(files.some(file=>file.name==='escape'&&file.symlink&&!file.directory))
    assert.ok(files.some(file=>file.name==='broken'&&file.symlink))
    assert.equal((await workspace.list('nested'))[0].path,'nested/sp ace.txt')
    assert.equal((await workspace.read('nested/sp ace.txt')).content,'中文内容\n')
    assert.equal(fixture.opens,1)
    await assert.rejects(workspace.list('../outside'),/outside workspaceRoot/)
    await assert.rejects(workspace.list('escape'),/symbolic link/)
    await assert.rejects(workspace.read('escape/secret'),/symbolic link/)
    await workspace.write('new','content')
    assert.equal(await readFile(join(root,'new'),'utf8'),'content')
    await assert.rejects(workspace.write('escape/secret','unsafe'),/symbolic link/)
    assert.equal(await readFile(join(outside,'secret'),'utf8'),'outside')
    await assert.rejects(readFile(join(directory,'injected')))
    const another=remoteWorkspace(fixture.session as any,root)
    await another.list('.');assert.equal(fixture.opens,1)
})

test('SSH text fallback preserves the 500 MiB limit and rejects binary, invalid UTF-8 and directories', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-shell-read-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    const text='x'.repeat(11*1024*1024)
    await writeFile(join(root,'large'),text)
    assert.equal((await workspace.read('large')).content,text)
    await truncate(join(root,'large'),500*1024*1024+1)
    await assert.rejects(workspace.read('large'),/500 MiB/)
    await writeFile(join(root,'binary'),Buffer.from([65,0,66]))
    await assert.rejects(workspace.read('binary'),/二进制/)
    await writeFile(join(root,'invalid'),Buffer.from([255]))
    await assert.rejects(workspace.read('invalid'),/encoded data|encoding|编码/)
    await assert.rejects(workspace.read('.'),/普通文本文件/)
    fixture.session.open=false
    await assert.rejects(workspace.list('.'),/SSH 已断开/)
    assert.equal(fixture.opens,1)
})

test('SFTP capability probe is shared per live connection and retried after reconnect',async()=>{
    let calls=0
    const sftp={}
    const session:any={open:true,ssh:{},async openSFTP(){calls++;await new Promise(resolve=>setImmediate(resolve));throw new Error('subsystem unavailable')}}
    assert.deepEqual(await Promise.all([optionalSftp(session),optionalSftp(session)]),[undefined,undefined])
    assert.equal(calls,1)
    session.ssh={}
    session.openSFTP=async()=>{calls++;return sftp}
    assert.equal(await optionalSftp(session),sftp)
    assert.equal(calls,2)
    session.open=false
    await assert.rejects(optionalSftp(session),/SSH 已断开/)
})

test('SFTP directory permission failures are not masked by a shell retry', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-shell-permission-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const fixture=sessionFixture(root)
    fixture.session.openSFTP=async()=>({async readdir(){throw new Error('Permission denied')}})
    const workspace=remoteWorkspace(fixture.session as any,root)
    await assert.rejects(workspace.list('.'),/Permission denied/)
    assert.ok(fixture.commands.every(command=>!command.includes('ARW_DIRECTORY_V1')))
})

test('SSH save preserves permissions, supports empty and large contents and does not put payload in commands', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-shell-save-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    await writeFile(join(root,'script.sh'),'before\n');await chmod(join(root,'script.sh'),0o751)
    const original=await workspace.read('script.sh')
    const saved=await workspace.write('script.sh','after\n',original.hash)
    assert.equal(await readFile(join(root,'script.sh'),'utf8'),'after\n')
    assert.equal((await stat(join(root,'script.sh'))).mode&0o777,0o751)
    assert.equal(saved.hash,(await workspace.read('script.sh')).hash)
    await workspace.write('empty','');assert.equal((await stat(join(root,'empty'))).size,0)
    assert.equal((await stat(join(root,'empty'))).mode&0o777,0o600)
    const text='敏感数据 $(touch injected)\n'+'x'.repeat(10*1024*1024-Buffer.byteLength('敏感数据 $(touch injected)\n'))
    await workspace.write('large',text)
    assert.equal((await workspace.read('large')).content,text)
    assert.ok(fixture.commands.every(command=>!command.includes('敏感数据')&&!command.includes(Buffer.from(text).toString('base64'))))
    await assert.rejects(readFile(join(root,'injected')))
    await workspace.write('large',text+'x')
    await assert.rejects(workspace.write('script.sh','conflict',original.hash),/文件已变化/)
    assert.equal(await readFile(join(root,'script.sh'),'utf8'),'after\n')
    assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
})

test('SSH save rejects a change immediately before truncation without staging files', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-shell-save-conflict-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    await writeFile(join(root,'file'),'original')
    let changed=false
    const fixture=sessionFixture(root,async command=>{
        if(!changed&&command.includes('cat >&3')){changed=true;await writeFile(join(root,'file'),'external change')}
    })
    const workspace=remoteWorkspace(fixture.session as any,root),original=await workspace.read('file')
    await assert.rejects(workspace.write('file','must not overwrite',original.hash),/文件已变化|Remote file changed/)
    assert.equal(await readFile(join(root,'file'),'utf8'),'external change')
    assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
    await symlink(join(root,'file'),join(root,'link'))
    await assert.rejects(workspace.write('link','unsafe'),/symbolic-link writes/)
    assert.equal(await readFile(join(root,'file'),'utf8'),'external change')
})

test('failed SSH writer marks partial in-place contents as unconfirmed', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-shell-save-failure-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const commands=join(root,'commands');await mkdir(commands)
    await writeFile(join(commands,'cat'),'#!/bin/sh\nprintf partial\nprintf "writer failed\\n" >&2\nexit 1\n',{mode:0o700})
    await writeFile(join(root,'file'),'original')
    const environment={...process.env,PATH:`${commands}:${process.env.PATH}`}
    const fixture=sessionFixture(root,undefined,environment)
    const workspace=remoteWorkspace(fixture.session as any,root)
    await assert.rejects(workspace.write('file','new value'),/writer failed/)
    assert.equal(await readFile(join(root,'file'),'utf8'),'partial')
    assert.ok(workspace.saveIssue?.('file'))
    await assert.rejects(workspace.write('file','retry'),/尚未确认/)
    environment.PATH=process.env.PATH!
    assert.equal((await workspace.reloadSave!('file')).content,'partial')
    assert.equal(workspace.saveIssue?.('file'),undefined)
    assert.ok((await readdir(root)).every(name=>!name.startsWith('.arw-')))
})

test('SFTP probe rejects a result from an earlier SSH connection',async()=>{
    let complete!:(value:unknown)=>void
    const session:any={open:true,ssh:{},openSFTP:()=>new Promise(resolve=>{complete=resolve})}
    const pending=optionalSftp(session)
    await new Promise(resolve=>setImmediate(resolve))
    session.ssh={};complete({})
    await assert.rejects(pending,/重连/)
    const current={};session.openSFTP=async()=>current
    assert.equal(await optionalSftp(session),current)
})

test('SFTP editor save verifies authoritative metadata and preserves contents and mode', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),"arw-save ' $-"))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'中文 file')
    await writeFile(target,'original');await chmod(target,0o640)
    const fixture=sessionFixture(root),sftp=sftpFixture()
    const originalStat=sftp.stat.bind(sftp)
    sftp.stat=async path=>({...await originalStat(path),mode:(await stat(path)).mode})
    fixture.session.openSFTP=async()=>sftp
    const workspace=remoteWorkspace(fixture.session as any,root)
    const original=await workspace.read('中文 file')
    fixture.commands.length=0
    await workspace.write('中文 file','updated\n',original.hash)
    assert.equal(fixture.commands.filter(command=>command.includes('stat -c')).length,1)
    assert.equal(fixture.commands.length,1,'validation and streaming share a single SSH channel')
    assert.equal(fixture.commands.filter(command=>command.includes('realpath -e')).length,1)
    assert.equal(await readFile(target,'utf8'),'updated\n')
    assert.equal((await stat(target)).mode&0o777,0o640)
    assert.deepEqual(await readdir(root),['中文 file'])
})

test('single-channel saves reject stale contents and symbolic-link targets', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-sftp-conflict-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file'),other=join(root,'other')
    await writeFile(target,'original');await writeFile(other,'other')
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root),original=await workspace.read('file')
    await writeFile(target,'external edit')
    await assert.rejects(workspace.write('file','overwrite',original.hash),/文件已变化/)
    assert.equal(await readFile(target,'utf8'),'external edit')
    await rm(target);await symlink(other,target)
    await assert.rejects(workspace.write('file','overwrite'),/symbolic-link writes/)
    assert.equal(await readFile(other,'utf8'),'other')
    assert.equal(workspace.saveIssue?.('file'),undefined)
})

test('single-channel saves preserve BOM hash semantics and stream content only after validation', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-sftp-warm-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'bom.txt')
    await writeFile(target,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('中文 before')]));await chmod(target,0o640)
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    const original=await workspace.read('bom.txt')
    assert.equal(original.hash,textHash('中文 before'))
    fixture.commands.length=0
    await workspace.write('bom.txt','中文 changed',original.hash)
    assert.equal(fixture.commands.length,1)
    assert.equal(await readFile(target,'utf8'),'中文 changed')
    assert.ok(fixture.commands.every(command=>!command.includes('中文 changed')))
    let uploaded=false
    fixture.hooks.afterInput=async()=>{uploaded=true}
    await assert.rejects(workspace.write('bom.txt','x'.repeat(11*1024*1024),original.hash),/文件已变化/)
    assert.equal(uploaded,false,'stale content fails before sending the payload')
    assert.equal(workspace.saveIssue?.('bom.txt'),undefined)
    assert.equal(await readFile(target,'utf8'),'中文 changed')
})

test('missing remote hashing fails before upload and leaves the file and warning state untouched', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-missing-hash-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file');await writeFile(target,'before')
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    const original=await workspace.read('file')
    let uploaded=false
    fixture.hooks.afterInput=async()=>{uploaded=true}
    fixture.hooks.rewrite=command=>command.replaceAll('sha256sum','arw_missing_sha256sum')
    await assert.rejects(workspace.write('file','after',original.hash),/arw_missing_sha256sum/)
    assert.equal(uploaded,false)
    assert.equal(await readFile(target,'utf8'),'before')
    assert.equal(workspace.saveIssue?.('file'),undefined)
})

test('special permission restore failure retains the save warning', {skip:process.platform!=='linux'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-special-failure-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file');await writeFile(target,'before');await chmod(target,0o6751)
    const fixture=sessionFixture(root),workspace=remoteWorkspace(fixture.session as any,root)
    const original=await workspace.read('file')
    fixture.hooks.rewrite=command=>command.replace('chmod "$_arw_mode" --', 'arw_missing_chmod "$_arw_mode" --')
    await assert.rejects(workspace.write('file','after',original.hash),/arw_missing_chmod/)
    assert.ok(workspace.saveIssue?.('file'))
    assert.equal(await readFile(target,'utf8'),'after')
    await assert.rejects(workspace.write('file','retry'),/尚未确认/)
})

test('background metadata checks yield to an in-flight remote save', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-priority-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file.txt');await writeFile(target,'before')
    const fixture=sessionFixture(root),sftp=sftpFixture()
    let reads=0,releaseWrite!:()=>void,markWriteStarted!:()=>void
    const writeReleased=new Promise<void>(resolve=>{releaseWrite=resolve}),writeStarted=new Promise<void>(resolve=>{markWriteStarted=resolve})
    fixture.hooks.afterInput=async()=>{markWriteStarted();await writeReleased}
    ;(sftp as any).readdir=async(path:string)=>{reads++;return readdirSync(path).map(name=>{const info=statSync(join(path,name));return {name,isDirectory:info.isDirectory(),isSymlink:info.isSymbolicLink(),size:info.size,modified:info.mtime}})}
    fixture.session.openSFTP=async()=>sftp
    const writer=remoteWorkspace(fixture.session as any,root),watcher=remoteWorkspace(fixture.session as any,root)
    const writing=writer.write('file.txt','after');await writeStarted
    const controller=new AbortController(),watching=watcher.watchSnapshot(()=>['.'],()=>{},controller.signal)
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(reads,0)
    releaseWrite();await writing
    for(let attempt=0;attempt<30&&!reads;attempt++)await new Promise(resolve=>setTimeout(resolve,20))
    assert.ok(reads>0)
    controller.abort();await watching
    assert.equal(await readFile(target,'utf8'),'after')
})

test('unavailable event watch falls back to cached metadata checks instead of rereading the tree', {skip:process.platform==='win32'}, async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-watch-fallback-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const target=join(root,'file.txt'),nested=join(root,'src');await mkdir(nested);await writeFile(target,'before')
    await writeFile(join(nested,'nested.txt'),'before')
    const fixture=sessionFixture(root),sftp=sftpFixture()
    ;(sftp as any).readdir=async(path:string)=>readdirSync(path).map(name=>{const info=statSync(join(path,name));return {name,isDirectory:info.isDirectory(),isSymbolicLink:info.isSymbolicLink(),size:info.size,modified:info.mtime}})
    fixture.session.openSFTP=async()=>sftp
    const workspace:any=remoteWorkspace(fixture.session as any,root)
    const controller=new AbortController(),changes:Array<string[]|undefined>=[]
    const pending=workspace.watchSnapshot(()=>['.','src'],inputs=>changes.push(inputs),controller.signal)
    await new Promise(resolve=>setTimeout(resolve,200))
    assert.equal(changes.length,0,'an unchanged directory does not trigger a tree refresh')
    await writeFile(target,'after with a different size')
    await writeFile(join(nested,'nested.txt'),'nested after with a different size')
    for(let attempt=0;attempt<80&&!changes.length;attempt++)await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(changes.length,1,'metadata changes trigger one event')
    assert.deepEqual(changes[0],['.','src'],'only the root and expanded directory are checked and reported')
    controller.abort();await pending
    assert.ok(fixture.commands.every(command=>!command.includes('ARW_DIRECTORY_V1')),'metadata checks never reread the full directory tree')
})

test('remote Git discovery streams a bounded directory prefix including unusual filenames',async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-remote-git-limit-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    for(const name of ['a file','line\nbreak','third','fourth'])await writeFile(join(root,name),'')
    const fixture=sessionFixture(root)
    const workspace=remoteWorkspace(fixture.session as any,root)
    const result=await workspace.listForGit!('.',2)
    assert.equal(result.entries.length,2)
    assert.equal(result.truncated,true)
    assert.ok(fixture.commands.some(command=>command.includes('head -z -n 6')))
})

test('a failed destination open never requests file contents but retains an unconfirmed save', {skip:process.platform==='win32'},async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-save-open-failed-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    await writeFile(join(root,'file'),'before')
    const fixture=sessionFixture(root)
    let uploaded=false
    fixture.hooks.afterInput=async()=>{uploaded=true}
    fixture.hooks.rewrite=command=>command.replaceAll('exec 3>','sleep 0.02; printf permission_denied >&2; exit 1; exec 3>')
    const workspace=remoteWorkspace(fixture.session as any,root)
    await assert.rejects(workspace.write('file','after'),/permission_denied/)
    assert.equal(uploaded,false,'do not upload until opening the destination succeeds')
    assert.equal(await readFile(join(root,'file'),'utf8'),'before')
    assert.ok(workspace.saveIssue?.('file'),'the pre-mutation acknowledgement still protects ambiguous failures')
})
