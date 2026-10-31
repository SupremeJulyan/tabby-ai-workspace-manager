import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentCwdPath, legacyAgentCwdPath } from '../src/arw-ai-cli/agent-cwd'
import { cleanupLegacyPlaceholders } from '../src/arw-ai-cli/legacy-cleanup'
import { installationConfigDirectory, installUserCli } from '../src/arw-ai-cli/cli-lifecycle'
import { cliGuidance, legacyCliGuidance, ensurePlaceholderGuidance, placeholderGuidance } from '../src/arw-cli/instructions'
import { writeWorkspaceBinding } from '../src/arw-cli/workspace-binding'

test('installation cleanup removes generated files, preserves user edits and is repeatable',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-install-cleanup-'))
    t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5}))
    const config=join(root,'custom-config'),storage=join(config,'awm'),identity={host:'fixture',port:22,user:'alice'}
    const make=async(remoteRoot:string,custom=false,terminalOnly=false)=>{
        const workspaceId=terminalOnly?'terminal:fixture':undefined
        const placeholder=agentCwdPath(remoteRoot,storage,identity,terminalOnly,workspaceId)
        await mkdir(join(placeholder,'.awm'),{recursive:true})
        await writeFile(join(placeholder,'.awm','workspace.json'),JSON.stringify({version:1,kind:'remote',...identity,remoteRoot,...(terminalOnly?{terminalOnly,workspaceId}:{})}))
        await writeFile(join(placeholder,'AGENTS.md'),custom?'user instructions':legacyCliGuidance(terminalOnly))
        return placeholder
    }
    const generated=await make('/generated'),custom=await make('/custom',true),terminal=await make('/terminal',false,true)
    const active=agentCwdPath('/active',storage,identity)
    writeWorkspaceBinding(active,{version:2,kind:'remote',workspaceId:'active',remoteRoot:'/active',...identity,terminalOnly:false})
    ensurePlaceholderGuidance(active,'/active')
    const legacy=legacyAgentCwdPath('/legacy',storage,identity)
    await mkdir(join(legacy,'.awm'),{recursive:true})
    await writeFile(join(legacy,'AGENTS.md'),legacyCliGuidance(false))
    await writeFile(join(legacy,'.awm','workspace.json'),JSON.stringify({version:1,kind:'remote',...identity,remoteRoot:'/legacy'}))
    await writeFile(join(custom,'.awm','notes.txt'),'user metadata')
    const project=join(config,'project');await mkdir(project);await writeFile(join(project,'AGENTS.md'),cliGuidance)
    await cleanupLegacyPlaceholders(config);await cleanupLegacyPlaceholders(config)
    await assert.rejects(access(join(generated,'AGENTS.md')),/ENOENT/)
    await assert.rejects(access(join(generated,'.awm')),/ENOENT/)
    await assert.rejects(access(join(legacy,'AGENTS.md')),/ENOENT/)
    await assert.rejects(access(join(legacy,'.awm')),/ENOENT/)
    await assert.rejects(access(join(terminal,'.awm')),/ENOENT/)
    await assert.rejects(access(join(terminal,'AGENTS.md')),/ENOENT/)
    assert.equal(await readFile(join(custom,'AGENTS.md'),'utf8'),'user instructions')
    assert.equal(await readFile(join(custom,'.awm','notes.txt'),'utf8'),'user metadata')
    assert.equal(await readFile(join(project,'AGENTS.md'),'utf8'),cliGuidance)
    assert.equal(JSON.parse(await readFile(join(active,'.awm','workspace.json'),'utf8')).workspaceId,'active')
    assert.equal(await readFile(join(active,'AGENTS.md'),'utf8'),placeholderGuidance('/active'))
    ensurePlaceholderGuidance(generated,'/generated')
    await cleanupLegacyPlaceholders(config)
    assert.equal(await readFile(join(generated,'AGENTS.md'),'utf8'),placeholderGuidance('/generated'),'installation preserves the new minimal context')
    // Install must clean even when PATH already contains the CLI directory.
    if(process.platform!=='win32'){
        await make('/generated')
        const source=join(root,'arw.cjs');await writeFile(source,'')
        await installUserCli(source,root,join(root,'.local','bin'),{configDirectory:config})
        await assert.rejects(access(join(generated,'AGENTS.md')),/ENOENT/)
        await assert.rejects(access(join(generated,'.awm')),/ENOENT/)
    }
})

test('cleanup skips linked placeholder trees and malformed or customized metadata',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-cleanup-boundary-'))
    t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5}))
    const config=join(root,'config'),storage=join(config,'awm'),identity={host:'fixture',port:22}
    const placeholder=agentCwdPath('/project',storage,identity),metadata=join(placeholder,'.awm','workspace.json')
    await mkdir(join(placeholder,'.awm'),{recursive:true});await writeFile(metadata,'invalid json')
    await cleanupLegacyPlaceholders(config);assert.equal(await readFile(metadata,'utf8'),'invalid json')
    await writeFile(metadata,JSON.stringify({version:1,kind:'remote',...identity,remoteRoot:'/project',custom:true}))
    await cleanupLegacyPlaceholders(config);assert.equal(JSON.parse(await readFile(metadata,'utf8')).custom,true)
    if(process.platform!=='win32'){
        const outside=join(root,'outside'),linked=join(config,'awm','agent-cwd','linked')
        await mkdir(join(outside,'aaaaaaaaaaaaaaaa'),{recursive:true});await writeFile(join(outside,'aaaaaaaaaaaaaaaa','AGENTS.md'),cliGuidance)
        await symlink(outside,linked)
        await cleanupLegacyPlaceholders(config)
        assert.equal(await readFile(join(outside,'aaaaaaaaaaaaaaaa','AGENTS.md'),'utf8'),cliGuidance)
    }
})

test('installer uses the actual Tabby config directory, including nondefault installations',()=>{
    const home=join(tmpdir(),'arw-config-home'),config=join(home,'custom')
    const source=join(config,'plugins','node_modules','tabby-ai-workspace-manager','dist','arw.cjs')
    assert.equal(installationConfigDirectory(source,home),config)
    assert.equal(installationConfigDirectory(source,home,{configDirectory:join(home,'explicit')}),join(home,'explicit'))
    assert.equal(installationConfigDirectory(join(home,'arw.cjs'),home,{platform:'darwin'}),join(home,'Library','Application Support','tabby'))
    assert.equal(installationConfigDirectory(join(home,'arw.cjs'),home,{platform:'win32'}),join(home,'AppData','Roaming','tabby'))
})
