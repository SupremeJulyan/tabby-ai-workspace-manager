import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readFile,readlink,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {installUserCli,uninstallUserCli,attachCliUninstall} from '../src/arw-ai-cli/cli-lifecycle'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

test('installation configures shells once and Tabby uninstall removes only owned integration',{skip:process.platform==='win32'},async()=>{
    const home=await mkdtemp(join(tmpdir(),'awm-install-'))
    try{
        const source=join(home,'arw.cjs')
        await writeFile(source,'#!/usr/bin/env node\n')
        await writeFile(join(home,'.bashrc'),'# user config\n')
        await installUserCli(source,home,'/usr/bin')
        await installUserCli(source,home,'/usr/bin')
        const rc=await readFile(join(home,'.bashrc'),'utf8')
        assert.equal(rc.split('# >>>').length,2)
        assert.match(await readFile(join(home,'.config/fish/conf.d/tabby-ai-workspace-manager.fish'),'utf8'),/contains/)
        const platform={async uninstallPlugin(name:string){if(name==='failed')throw new Error('failed')}}
        const detach=attachCliUninstall(platform,source,home)
        await assert.rejects(platform.uninstallPlugin('failed'))
        await platform.uninstallPlugin('other')
        assert.equal(await readlink(join(home,'.local/bin/arw')),source)
        await platform.uninstallPlugin('tabby-ai-workspace-manager')
        await assert.rejects(readlink(join(home,'.local/bin/arw')))
        assert.equal(await readFile(join(home,'.bashrc'),'utf8'),'# user config\n')
        detach()
    }finally{await rm(home,{recursive:true,force:true})}
})

test('macOS login shells receive PATH without creating a higher-priority Bash startup file',{skip:process.platform==='win32'},async context=>{
    const home=await mkdtemp(join(tmpdir(),'arw-mac-login-'));context.after(()=>rm(home,{recursive:true,force:true}))
    const source=join(home,'arw.cjs');await writeFile(source,'')
    const options={platform:'darwin' as const}
    await writeFile(join(home,'.bash_login'),'export ARW_LOGIN_TEST=kept\n')
    await installUserCli(source,home,'/usr/bin',options)
    await assert.rejects(readFile(join(home,'.bash_profile')))
    const result=await promisify(execFile)('/bin/bash',['--login','-c','printf "%s\\n%s" "$ARW_LOGIN_TEST" "$PATH"'],{env:{...process.env,HOME:home},encoding:'utf8'})
    assert.equal(result.stdout.split('\n')[0],'kept');assert.ok(result.stdout.includes(join(home,'.local/bin')))
    assert.match(await readFile(join(home,'.zprofile'),'utf8'),/tabby-ai-workspace-manager PATH/)
    await writeFile(join(home,'.bash_profile'),'# user login\n')
    await installUserCli(source,home,'/usr/bin',options)
    assert.match(await readFile(join(home,'.bash_profile'),'utf8'),/^# user login\n/)
    await uninstallUserCli(source,home,options)
    assert.equal(await readFile(join(home,'.bash_login'),'utf8'),'export ARW_LOGIN_TEST=kept\n')
    assert.equal(await readFile(join(home,'.bash_profile'),'utf8'),'# user login\n')
})
