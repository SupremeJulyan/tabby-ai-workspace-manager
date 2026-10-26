import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { ensureAgentCwdPlaceholder } from '../src/arw-ai-cli/agent-cwd'
import { prepareAiRecovery, resumeArguments } from '../src/arw-ai-cli/recovery'

const execute=promisify(execFile)
test('AI recovery uses cwd-scoped continuation without duplicating explicit resume arguments',()=>{
    assert.deepEqual(resumeArguments('/opt/tools/codex',['--model','custom']),['resume','--last','--model','custom'])
    assert.deepEqual(resumeArguments('C:\\tools\\codex.cmd',['resume','abc']),['resume','abc'])
    assert.deepEqual(resumeArguments('claude',[]),['--continue'])
    assert.deepEqual(resumeArguments('claude.exe',['--resume','abc']),['--resume','abc'])
    assert.deepEqual(resumeArguments('codex',['exec','echo hello']),['exec','echo hello'])
    assert.deepEqual(resumeArguments('/bin/custom-agent',['--flag']),['--flag'])
})

test('fresh AI launch stays fresh; persisted and legacy tabs resume with a working persistent CLI',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-resume-'))
    try{
        const {localPath}=await ensureAgentCwdPlaceholder('/home/alice/project',storage,{host:'host',user:'alice',port:22})
        const options={command:'codex',args:['--model','custom'],cwd:localPath,
            env:{ARW_WORKSPACE_ROOT:'/home/alice/project',ARW_LOCAL_WORKSPACE_ROOT:localPath,
                ARW_AI_FRESH_START:'1',ARW_CONFIG:'/deleted/temp/connection.json',PATH:'/deleted/temp/bin'}}
        const source=join(storage,'arw.cjs')
        await mkdir(join(storage,'bin'),{recursive:true})
        await copyFile(join(process.cwd(),'dist/arw.cjs'),source)
        const shim=join(storage,'bin',process.platform==='win32'?'arw.cmd':'arw')
        await writeFile(shim,process.platform==='win32'?'@node "%~dp0..\\arw.cjs" %*\r\n':'#!/usr/bin/env node\nrequire("../arw.cjs");\n')
        const tab={profile:{type:'local',name:'AI',options},async getRecoveryToken(){return {type:'app:local-tab',profile:this.profile,savedState:'screen'}}}
        prepareAiRecovery(tab,storage,source)
        assert.deepEqual(tab.profile.options.args,['--model','custom'])
        const token=await tab.getRecoveryToken()
        assert.deepEqual(token.profile.options.args,['resume','--last','--model','custom'])
        assert.equal(token.profile.options.cwd,localPath)
        assert.equal(token.savedState,'screen')
        assert.equal(token.profile.options.env.ARW_CONFIG,undefined)
        assert.equal(token.profile.options.env.ARW_AI_FRESH_START,undefined)
        const binary=join(token.profile.options.env.PATH.split(delimiter)[0],process.platform==='win32'?'arw.cmd':'arw')
        const version=process.platform==='win32'
            ?await execute(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`""${binary}" --version"`],{windowsVerbatimArguments:true})
            :await execute(process.execPath,[binary,'--version'])
        assert.equal(version.stdout.trim(),`arw ${JSON.parse(await readFile(join(process.cwd(),'package.json'),'utf8')).version}`)
        const restored={profile:token.profile,sessionOptions:options,async getRecoveryToken(){return {type:'app:local-tab',profile:this.profile,savedState:'new screen'}}}
        prepareAiRecovery(restored,storage,source)
        assert.deepEqual(restored.profile.options.args,['resume','--last','--model','custom'])
        assert.equal(restored.sessionOptions,restored.profile.options)
        assert.deepEqual((await restored.getRecoveryToken()).profile.options.args,['resume','--last','--model','custom'])
        const legacy={profile:{type:'local',options:{...options,env:{...options.env,ARW_AI_FRESH_START:''}}}}
        prepareAiRecovery(legacy,storage,source)
        assert.deepEqual(legacy.profile.options.args,['resume','--last','--model','custom'])
        const instructions=await readFile(join(localPath,'AGENTS.md'),'utf8')
        assert.ok(instructions.length<1600)
        assert.doesNotMatch(instructions,/safs|SKILL\.md|127\.0\.0\.1/i)
        const unrelated={profile:{type:'local',options:{command:'codex',args:[],env:{}}}}
        prepareAiRecovery(unrelated,storage,source)
        assert.deepEqual(unrelated.profile.options.args,[])
    }finally{await rm(storage,{recursive:true,force:true})}
})

test('explicit recovery arguments replace launch arguments, including an intentionally empty list',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-separate-args-'))
    try{
        const options={command:'codex',args:['--new','initial prompt'],cwd:storage,env:{ARW_WORKSPACE_ROOT:storage,ARW_AI_FRESH_START:'1'}}
        const tab={profile:{type:'local',options},async getRecoveryToken(){return {type:'app:local-tab',profile:this.profile}}}
        prepareAiRecovery(tab,storage,join(process.cwd(),'dist/arw.cjs'),['--resume','session-id','--model','recovery-model'])
        assert.deepEqual(tab.profile.options.args,['--new','initial prompt'])
        const token=await tab.getRecoveryToken()
        assert.deepEqual(token.profile.options.args,['--resume','session-id','--model','recovery-model'])
        const preserved={profile:token.profile}
        prepareAiRecovery(preserved,storage,join(process.cwd(),'dist/arw.cjs'))
        assert.deepEqual(preserved.profile.options.args,['--resume','session-id','--model','recovery-model'])
        const restored={profile:token.profile}
        prepareAiRecovery(restored,storage,join(process.cwd(),'dist/arw.cjs'),[])
        assert.deepEqual(restored.profile.options.args,[])
        assert.deepEqual(tab.profile.options.args,['--new','initial prompt'])
    }finally{await rm(storage,{recursive:true,force:true})}
})

test('restored AI tabs resume their CLI inside the original shell when shell-provided env is gone',async()=>{
    const storage=await mkdtemp(join(tmpdir(),'arw-shell-resume-'))
    try{
        const options={command:'/bin/bash',shellType:'unix',args:['--login','-i','-c',"exec '/opt/codex' '--model' 'custom'"],cwd:storage,
            env:{ARW_WORKSPACE_ROOT:storage,ARW_AGENT_COMMAND:'/opt/codex',ARW_AGENT_ARGS:JSON.stringify(['--model','custom']),
                ARW_AGENT_SHELL_COMMAND:'/bin/bash',ARW_AGENT_SHELL_ARGS:JSON.stringify(['--login']),ARW_AGENT_SHELL_TYPE:'unix',
                PATH:'/opt/bin',KP_ROUTER_KEY:'from-tab'}}
        const tab={profile:{type:'local',options},async getRecoveryToken(){return {type:'app:local-tab',profile:this.profile}}}
        const source=join(process.cwd(),'dist/arw.cjs')
        prepareAiRecovery(tab,storage,source,['resume','--last','--model','custom'])
        assert.equal(tab.profile.options.command,'/bin/bash')
        assert.deepEqual(tab.profile.options.args,['--login','-i','-c',"exec '/opt/codex' 'resume' '--last' '--model' 'custom'"])
        assert.equal(tab.profile.options.env.KP_ROUTER_KEY,'from-tab')
        assert.equal(tab.profile.options.shellType,'unix')
        const token=await tab.getRecoveryToken()
        assert.deepEqual(token.profile.options.args,['--login','-i','-c',"exec '/opt/codex' 'resume' '--last' '--model' 'custom'"])
        assert.equal(token.profile.options.env.ARW_AGENT_ARGS,JSON.stringify(['resume','--last','--model','custom']))
    }finally{await rm(storage,{recursive:true,force:true})}
})
