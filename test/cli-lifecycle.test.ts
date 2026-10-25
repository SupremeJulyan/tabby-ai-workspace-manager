import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readFile,readlink,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {installUserCli,attachCliUninstall} from '../src/arw-ai-cli/cli-lifecycle'

test('installation configures shells once and Tabby uninstall removes only owned integration',async()=>{
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
