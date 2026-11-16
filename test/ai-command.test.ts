import assert from 'node:assert/strict'
import test from 'node:test'
import { aiName, commandTokens, configuredAiCommands, parseAiCommand } from '../src/arw-ai-cli/ai-command'
import { CODEX_FULL_ACCESS_ARGUMENTS } from '../src/arw-ai-cli/defaults'

test('AI commands parse absolute binaries, quoted paths, and arguments without shell expansion',()=>{
    assert.deepEqual(parseAiCommand('/usr/bin/codex --no-daemon --model "gpt 5"'),
        {executable:'/usr/bin/codex',args:['--no-daemon','--model','gpt 5']})
    assert.equal(aiName('/usr/bin/codex --no-daemon'),'codex')
    assert.deepEqual(parseAiCommand('"C:\\Program Files\\Codex\\codex.exe" --no-daemon "two words"'),
        {executable:'C:\\Program Files\\Codex\\codex.exe',args:['--no-daemon','two words']})
    assert.deepEqual(commandTokens("'/opt/agent tool' --flag a\\ b"),['/opt/agent tool','--flag','a b'])
})

test('AI commands accept PATH names and reject malformed quotes or empty input',()=>{
    assert.deepEqual(parseAiCommand('codex --no-daemon'),{executable:'codex',args:['--no-daemon']})
    assert.throws(()=>parseAiCommand('/usr/bin/codex "unterminated'),/引号未闭合/)
    assert.throws(()=>parseAiCommand(''),/启动命令/)
})

test('Codex is the default only when no AI configuration is present',()=>{
    const agents=configuredAiCommands({})
    assert.equal(agents[0].id,'default-codex')
    assert.deepEqual(parseAiCommand(agents[0].command),{executable:'codex',args:[...CODEX_FULL_ACCESS_ARGUMENTS]})
    assert.deepEqual(parseAiCommand(agents[0].resumeCommand),{
        executable:'codex',args:['resume','--last',...CODEX_FULL_ACCESS_ARGUMENTS],
    })
    assert.equal(agents[1].id,'default-claude')
    assert.deepEqual(parseAiCommand(agents[1].command),{executable:'claude',args:['--dangerously-skip-permissions']})
    assert.deepEqual(parseAiCommand(agents[1].resumeCommand),{
        executable:'claude',args:['--continue','--dangerously-skip-permissions'],
    })
    assert.deepEqual(configuredAiCommands({agents:[]}).map(agent=>agent.id),['default-codex','default-claude'])
    assert.deepEqual(configuredAiCommands({agents:[],agentsConfigured:true}),[])
})

test('legacy AI CLI configuration migrates into a selectable command entry',()=>{
    const agents=configuredAiCommands({agents:[],agent:{
        command:'/opt/codex',args:['--model','gpt 5'],resumeArgs:['resume','--last'],proxyUrl:'http://127.0.0.1:7897',
        shell:{command:'/bin/bash'},
    }})
    assert.equal(agents.length,2)
    assert.equal(agents[0].id,'legacy-agent')
    assert.deepEqual(parseAiCommand(agents[0].command),{executable:'/opt/codex',args:['--model','gpt 5']})
    assert.deepEqual(parseAiCommand(agents[0].resumeCommand),{executable:'/opt/codex',args:['resume','--last']})
    assert.equal(agents[0].proxyUrl,'http://127.0.0.1:7897')
    assert.deepEqual(agents[0].legacyShell,{command:'/bin/bash'})
    assert.equal(agents[1].id,'default-claude')
})
