import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { prepareAiRecovery } from '../src/arw-ai-cli/recovery'
import { ensureAgentCwdPlaceholder } from '../src/arw-ai-cli/agent-cwd'

test('remote placeholders use the IP and port hex plus the absolute remote path hash', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'arw-agent-cwd-'))
    try {
        const identity = { host:'10.44.9.4', user:'alice', port:22 }
        const pathHash = createHash('sha256').update('/home/alice/project').digest('hex').slice(0, 16)
        const first = await ensureAgentCwdPlaceholder('/home/alice/project', storage, identity)
        const repeated = await ensureAgentCwdPlaceholder('/home/alice/./project', storage, identity)
        assert.equal(first.created, true)
        assert.equal(repeated.created, false)
        assert.equal(first.localPath, repeated.localPath)
        assert.equal(basename(first.localPath), pathHash)
        assert.equal(first.localPath, join(storage, 'agent-cwd', '0a2c0904-16', pathHash))
        await assert.rejects(access(join(first.localPath, '.agents/skills/arw-cli/SKILL.md')))
        assert.equal(JSON.parse(await readFile(join(first.localPath, '.awm/workspace.json'), 'utf8')).remoteRoot, '/home/alice/project')
        const instructions=await readFile(join(first.localPath, 'AGENTS.md'), 'utf8')
        assert.match(instructions, /arw workspaces/)
        assert.match(instructions, /--id ID/)
        assert.match(instructions, /POLICY_DENIED/)
        assert.doesNotMatch(instructions, /SKILL\.md/)
        await assert.rejects(access(join(first.localPath, 'CLAUDE.md')))
        assert.ok(first.localPath.startsWith(join(storage, 'agent-cwd')))
        for (const changed of [{...identity,port:8080},{...identity,host:'10.44.9.5'}]) {
            assert.notEqual((await ensureAgentCwdPlaceholder('/home/alice/project', storage, changed)).localPath, first.localPath)
        }
        assert.equal((await ensureAgentCwdPlaceholder('/home/alice/project', storage, {...identity,user:'bob'})).localPath, first.localPath)
        const a = await ensureAgentCwdPlaceholder('/a b/project', storage, identity)
        const b = await ensureAgentCwdPlaceholder('/a_b/project', storage, identity)
        assert.notEqual(a.localPath, b.localPath)
        const root = await ensureAgentCwdPlaceholder('/', storage, identity)
        assert.equal(basename(root.localPath), createHash('sha256').update('/').digest('hex').slice(0, 16))
        await assert.rejects(ensureAgentCwdPlaceholder('../project', storage, identity), /absolute remote path/)
        await assert.rejects(ensureAgentCwdPlaceholder('/home/alice/project', storage, {...identity,port:0}), /valid SSH port/)
    } finally { await rm(storage, { recursive:true, force:true }) }
})

test('terminal mode uses separate command-only guidance without replacing normal workspace instructions',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-terminal-cwd-'))
    try{
        const identity={host:'fixture',user:'alice'}
        const normal=await ensureAgentCwdPlaceholder('/project',storage,identity)
        const terminal=await ensureAgentCwdPlaceholder('/project',storage,identity,true,'terminal:first')
        assert.notEqual(normal.localPath,terminal.localPath)
        const metadata=JSON.parse(await readFile(join(terminal.localPath,'.awm/workspace.json'),'utf8'))
        assert.equal(metadata.workspaceId,'terminal:first');assert.equal(metadata.terminalOnly,true)
        assert.notEqual((await ensureAgentCwdPlaceholder('/project',storage,identity,true,'terminal:second')).localPath,terminal.localPath)
        const instructions=await readFile(join(terminal.localPath,'AGENTS.md'),'utf8')
        assert.match(instructions,/Use arw exec for all project operations/);assert.match(instructions,/existing terminal/)
        assert.match(instructions,/arw COMMAND --help/)
        prepareAiRecovery({profile:{type:'local',options:{command:'codex',args:[],cwd:terminal.localPath,env:{ARW_WORKSPACE_ROOT:'/project',ARW_LOCAL_WORKSPACE_ROOT:terminal.localPath,ARW_AI_FRESH_START:'1'}}}} as any,storage,'/plugin/arw.cjs')
        assert.equal(await readFile(join(terminal.localPath,'AGENTS.md'),'utf8'),instructions,'recovery preparation preserves terminal-only instructions')
        assert.match(await readFile(join(normal.localPath,'AGENTS.md'),'utf8'),/arw COMMAND --help/)
    }finally{await rm(storage,{recursive:true,force:true})}
})

test('launch and recovery create missing instructions and preserve any existing content',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-preserve-instructions-'))
    try{
        for(const terminalOnly of [false,true]){
            const identity={host:'fixture',user:'alice'}
            const ensure=()=>ensureAgentCwdPlaceholder('/project',storage,identity,terminalOnly,'terminal:first')
            const {localPath}=await ensure()
            const path=join(localPath,'AGENTS.md')
            const guidance=await readFile(path,'utf8')
            const recover=()=>prepareAiRecovery({profile:{type:'local',options:{command:'codex',args:[],cwd:localPath,env:{ARW_WORKSPACE_ROOT:'/project',ARW_LOCAL_WORKSPACE_ROOT:localPath,ARW_AI_FRESH_START:'1'}}}} as any,storage,'/missing/arw.cjs')
            for(const content of ['custom instructions','']){
                await writeFile(path,content)
                await ensure()
                assert.equal(await readFile(path,'utf8'),content)
                recover()
                assert.equal(await readFile(path,'utf8'),content)
            }
            await rm(path)
            recover()
            assert.equal(await readFile(path,'utf8'),guidance)
            await rm(path)
            await ensure()
            assert.equal(await readFile(path,'utf8'),guidance)
        }
    }finally{await rm(storage,{recursive:true,force:true})}
})
