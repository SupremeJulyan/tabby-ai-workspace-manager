import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalDirectoryCommand } from '../src/shared/terminal-directory-command'
import { shellQuote } from '../src/shared/shell-quote'

for (const [command, root, expected] of [
    ['bash', "/project's path", "cd -- " + shellQuote("/project's path")],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', "C:\\Users\\O'Brien", "cd -LiteralPath 'C:\\Users\\O''Brien'"],
    ['powershell.exe', 'C:\\Users\\juyan', "cd -LiteralPath 'C:\\Users\\juyan'"],
    ['cmd.exe', 'D:\\some path', 'cd /d "D:\\some path"'],
]) {
    test('quotes the directory for ' + command, () => {
        assert.equal(terminalDirectoryCommand({profile:{options:{command}}},root),expected)
    })
}

test('rejects multiline directory paths', () => {
    assert.throws(() => terminalDirectoryCommand({},'/project\npwd'),/Invalid terminal directory/)
})

test('honors local and remote PowerShell shell hints', () => {
    for (const type of ['local','ssh']) {
        const tab={profile:{type,options:{shellType:'powershell'}}}
        assert.equal(terminalDirectoryCommand(tab,"C:\\project's [data]"),"cd -LiteralPath 'C:\\project''s [data]'")
    }
})

test('CMD uses pushd for UNC and rejects variable expansion', () => {
    const tab={profile:{options:{command:'cmd.exe'}}}
    assert.equal(terminalDirectoryCommand(tab,'\\\\server\\share\\project'),'pushd "\\\\server\\share\\project"')
    for (const path of ['C:\\%TEMP%','C:\\!name!']) {
        assert.throws(() => terminalDirectoryCommand(tab,path),/CMD cannot safely/)
    }
})

test('Fish escapes literal backslashes and apostrophes', () => {
    const tab={profile:{type:'ssh',options:{command:'/usr/bin/fish'}}}
    assert.equal(terminalDirectoryCommand(tab,"/srv/a\\b's"),"cd -- '/srv/a\\\\b\\'s'")
})

test('WSL and Git Bash convert Windows paths in their respective runtimes', () => {
    for (const [command,converter] of [['wsl.exe','wslpath'],['C:\\Git\\bin\\bash.exe','cygpath']]) {
        const tab={profile:{type:'local',options:{command}}}
        assert.equal(terminalDirectoryCommand(tab,'D:\\some path'), 'cd -- "$(' + converter + " -u 'D:\\some path')\"")
    }
})
