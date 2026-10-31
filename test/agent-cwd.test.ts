import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { prepareAiRecovery } from '../src/arw-ai-cli/recovery'
import { agentCwdPath, legacyAgentCwdPath, ensureAgentCwdPlaceholder } from '../src/arw-ai-cli/agent-cwd'
import { cliGuidance, terminalCliGuidance, legacyCliGuidance, placeholderGuidance } from '../src/arw-cli/instructions'

test('flat names escape separators, distinguish accounts, and bound long components',()=>{
    const storage=join(tmpdir(),'arw-flat-names'),identity={host:'10.44.9.4',port:22,user:'zhuyuan'}
    assert.equal(basename(agentCwdPath('/home/share/zhuyuan/c2_tests',storage,identity)),'10.44.9.4@22@zhuyuan-home-share-zhuyuan-c2_tests')
    for(const [left,right] of [['/a-b/c','/a/b-c'],['/','/root'],['/foo/terminal','/foo'],['/a b','/a%20b']])
        assert.notEqual(agentCwdPath(left,storage,identity),agentCwdPath(right,storage,identity))
    assert.notEqual(agentCwdPath('/a',storage,{...identity,user:'alice-bob'}),agentCwdPath('/bob/a',storage,{...identity,user:'alice'}))
    assert.notEqual(agentCwdPath('/foo/terminal',storage,identity),agentCwdPath('/foo',storage,identity,true))
    const special=basename(agentCwdPath('/dir:bad/name?end.',storage,{host:'2001:db8::1',user:'alice@server'}))
    assert.doesNotMatch(special,/[<>:"/\\|?*]|\.$/)
    const long=agentCwdPath('/'+('segment/'.repeat(100)),storage,identity)
    assert.ok(Buffer.byteLength(basename(long))<=242)
    assert.notEqual(long,agentCwdPath('/'+('segment/'.repeat(100))+'other',storage,identity))
})

test('legacy hash directories remain valid recovery locations without being renamed',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-old-cwd-'))
    try{
        const identity={host:'10.44.9.4',port:22,user:'alice'}
        for(const terminalMode of [false,true]){
            const workspaceId='terminal:old',cwd=legacyAgentCwdPath('/project',storage,identity,terminalMode,terminalMode?workspaceId:undefined)
            await mkdir(cwd,{recursive:true});await writeFile(join(cwd,'session.txt'),'preserve')
            const tab={profile:{type:'local',options:{command:'codex',args:[],cwd,env:{ARW_WORKSPACE_ROOT:'/project',ARW_WORKSPACE_HOST:identity.host,ARW_WORKSPACE_PORT:'22',ARW_WORKSPACE_USER:identity.user,ARW_LOCAL_WORKSPACE_ROOT:cwd,ARW_WORKSPACE_ID:workspaceId,ARW_TERMINAL_MODE:terminalMode?'1':'0'}}}}
            prepareAiRecovery(tab,storage,'/missing/arw.cjs')
            assert.equal(tab.profile.options.cwd,cwd)
            assert.equal(await readFile(join(cwd,'session.txt'),'utf8'),'preserve')
        }
    }finally{await rm(storage,{recursive:true,force:true,maxRetries:5})}
})

test('legacy metadata is removed without deleting unrelated placeholder files',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-metadata-cleanup-'))
    try{
        const identity={host:'fixture',user:'alice',port:22},ensure=()=>ensureAgentCwdPlaceholder('/project',storage,identity)
        const {localPath}=await ensure(),directory=join(localPath,'.awm'),file=join(directory,'workspace.json')
        const metadata={version:1,kind:'remote',...identity,remoteRoot:'/project'}
        await mkdir(directory);await writeFile(file,JSON.stringify(metadata))
        await ensure();await assert.rejects(access(directory),/ENOENT/)
        await mkdir(directory);await writeFile(file,JSON.stringify(metadata));await writeFile(join(directory,'custom.txt'),'keep')
        await ensure();await assert.rejects(access(file),/ENOENT/)
        assert.equal(await readFile(join(directory,'custom.txt'),'utf8'),'keep')
        await writeFile(file,JSON.stringify({...metadata,custom:true}))
        await ensure();assert.equal(JSON.parse(await readFile(file,'utf8')).custom,true)
    }finally{await rm(storage,{recursive:true,force:true,maxRetries:5})}
})

test('recovery migrates saved identity once and validates the directory binding',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-env-recovery-'))
    try{
        const {localPath}=await ensureAgentCwdPlaceholder('/project',storage,{host:'fixture',port:22})
        const env={ARW_WORKSPACE_ID:'bound',ARW_WORKSPACE_KIND:'remote',ARW_WORKSPACE_HOST:'fixture',ARW_WORKSPACE_PORT:'22',ARW_WORKSPACE_ROOT:'/project',ARW_LOCAL_WORKSPACE_ROOT:localPath}
        const terminal=(change:Record<string,string>={})=>({profile:{type:'local',options:{command:'codex',args:[],cwd:localPath,env:{...env,...change}}}})
        prepareAiRecovery(terminal(),storage,'/missing/arw.cjs')
        const file=join(localPath,'.awm','workspace.json'),binding=JSON.parse(await readFile(file,'utf8'))
        assert.equal(binding.workspaceId,'bound')
        assert.throws(()=>prepareAiRecovery(terminal({ARW_WORKSPACE_ID:'another-session'}),storage,'/missing/arw.cjs'),/不匹配/)
        prepareAiRecovery(terminal({ARW_WORKSPACE_ROOT:'/wrong/local'}),storage,'/missing/arw.cjs')
        for(const change of [{remoteRoot:'/other'},{host:'other'},{port:2222},{terminalOnly:true}]){
            await writeFile(file,JSON.stringify({...binding,...change}))
            assert.throws(()=>prepareAiRecovery(terminal(),storage,'/missing/arw.cjs'),/不匹配/)
        }
    }finally{await rm(storage,{recursive:true,force:true,maxRetries:5})}
})

test('only unchanged legacy instructions are replaced with minimal placeholder context',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-guidance-migration-'))
    try{
        for(const terminalOnly of [false,true]){
            const ensure=()=>ensureAgentCwdPlaceholder('/project',storage,{host:'fixture',user:'alice'},terminalOnly,'terminal:bound')
            const {localPath}=await ensure(),file=join(localPath,'AGENTS.md')
            await writeFile(file,legacyCliGuidance(terminalOnly))
            await ensure()
            assert.equal(await readFile(file,'utf8'),placeholderGuidance('/project'))
            await writeFile(file,terminalOnly?terminalCliGuidance:cliGuidance)
            await ensure()
            assert.equal(await readFile(file,'utf8'),placeholderGuidance('/project'))
            const customized=legacyCliGuidance(terminalOnly)+'\nUser instructions\n'
            await writeFile(file,customized);await ensure()
            assert.equal(await readFile(file,'utf8'),customized)
        }
    }finally{await rm(storage,{recursive:true,force:true,maxRetries:5})}
})

test('remote placeholders use a flat host@port@user-path directory', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'arw-agent-cwd-'))
    try {
        const identity = { host:'10.44.9.4', user:'alice', port:22 }
        const directoryName='10.44.9.4@22@alice-home-alice-project'
        const first = await ensureAgentCwdPlaceholder('/home/alice/project', storage, identity)
        const repeated = await ensureAgentCwdPlaceholder('/home/alice/./project', storage, identity)
        assert.equal(first.created, true)
        assert.equal(repeated.created, false)
        assert.equal(first.localPath, repeated.localPath)
        assert.equal(basename(first.localPath), directoryName)
        assert.equal(first.localPath, join(storage, 'agent-cwd', directoryName))
        await assert.rejects(access(join(first.localPath, '.agents/skills/arw-cli/SKILL.md')))
        await assert.rejects(access(join(first.localPath,'.awm')),/ENOENT/)
        assert.equal(await readFile(join(first.localPath,'AGENTS.md'),'utf8'),placeholderGuidance('/home/alice/project'))
        await assert.rejects(access(join(first.localPath, 'CLAUDE.md')))
        assert.ok(first.localPath.startsWith(join(storage, 'agent-cwd')))
        for (const changed of [{...identity,port:8080},{...identity,host:'10.44.9.5'}]) {
            assert.notEqual((await ensureAgentCwdPlaceholder('/home/alice/project', storage, changed)).localPath, first.localPath)
        }
        assert.notEqual((await ensureAgentCwdPlaceholder('/home/alice/project', storage, {...identity,user:'bob'})).localPath, first.localPath)
        const a = await ensureAgentCwdPlaceholder('/a b/project', storage, identity)
        const b = await ensureAgentCwdPlaceholder('/a_b/project', storage, identity)
        assert.notEqual(a.localPath, b.localPath)
        const root = await ensureAgentCwdPlaceholder('/', storage, identity)
        assert.equal(basename(root.localPath),'10.44.9.4@22@alice-%2F')
        await assert.rejects(ensureAgentCwdPlaceholder('../project', storage, identity), /absolute remote path/)
        await assert.rejects(ensureAgentCwdPlaceholder('/home/alice/project', storage, {...identity,port:0}), /valid SSH port/)
    } finally { await rm(storage, { recursive:true, force:true }) }
})

test('terminal mode keeps its identity and only minimal startup context',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-terminal-cwd-'))
    try{
        const identity={host:'fixture',user:'alice'}
        const normal=await ensureAgentCwdPlaceholder('/project',storage,identity)
        const terminal=await ensureAgentCwdPlaceholder('/project',storage,identity,true,'terminal:first')
        assert.notEqual(normal.localPath,terminal.localPath)
        await assert.rejects(access(join(terminal.localPath,'.awm')),/ENOENT/)
        assert.notEqual((await ensureAgentCwdPlaceholder('/project',storage,identity,true,'terminal:second')).localPath,terminal.localPath)
        assert.equal(await readFile(join(terminal.localPath,'AGENTS.md'),'utf8'),placeholderGuidance('/project'))
        prepareAiRecovery({profile:{type:'local',options:{command:'codex',args:[],cwd:terminal.localPath,env:{ARW_WORKSPACE_HOST:'fixture',ARW_WORKSPACE_USER:'alice',ARW_WORKSPACE_ROOT:'/project',ARW_LOCAL_WORKSPACE_ROOT:terminal.localPath,ARW_AI_FRESH_START:'1'}}}} as any,storage,'/plugin/arw.cjs')
        assert.equal(await readFile(join(terminal.localPath,'AGENTS.md'),'utf8'),placeholderGuidance('/project'))
        assert.equal(await readFile(join(normal.localPath,'AGENTS.md'),'utf8'),placeholderGuidance('/project'))
    }finally{await rm(storage,{recursive:true,force:true})}
})

test('launch and recovery preserve user instructions and restore missing minimal context',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-preserve-instructions-'))
    try{
        for(const terminalOnly of [false,true]){
            const identity={host:'fixture',user:'alice'}
            const ensure=()=>ensureAgentCwdPlaceholder('/project',storage,identity,terminalOnly,'terminal:first')
            const {localPath}=await ensure()
            const path=join(localPath,'AGENTS.md')
            assert.equal(await readFile(path,'utf8'),placeholderGuidance('/project'))
            const recover=()=>prepareAiRecovery({profile:{type:'local',options:{command:'codex',args:[],cwd:localPath,env:{ARW_WORKSPACE_HOST:'fixture',ARW_WORKSPACE_USER:'alice',ARW_WORKSPACE_ID:terminalOnly?'terminal:first':'bound',ARW_WORKSPACE_ROOT:'/project',ARW_LOCAL_WORKSPACE_ROOT:localPath,ARW_AI_FRESH_START:'1'}}}} as any,storage,'/missing/arw.cjs')
            for(const content of ['custom instructions','']){
                await writeFile(path,content)
                await ensure()
                assert.equal(await readFile(path,'utf8'),content)
                recover()
                assert.equal(await readFile(path,'utf8'),content)
            }
            await rm(path)
            recover()
            assert.equal(await readFile(path,'utf8'),placeholderGuidance('/project'))
            await ensure()
            assert.equal(await readFile(path,'utf8'),placeholderGuidance('/project'))
            await writeFile(path,terminalOnly?terminalCliGuidance:cliGuidance)
            recover()
            assert.equal(await readFile(path,'utf8'),placeholderGuidance('/project'))
        }
    }finally{await rm(storage,{recursive:true,force:true})}
})
