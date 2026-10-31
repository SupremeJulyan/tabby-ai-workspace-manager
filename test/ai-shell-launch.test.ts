import assert from 'node:assert/strict'
import test from 'node:test'
import { configuredShell } from '../src/arw-ai-cli/settings-shell'
import { replaceShellArguments, shellCommand, shellCommandLine, shellEnvironment } from '../src/arw-ai-cli/shell'
import { selectableShells } from '../src/arw-ai-cli/shell-selection'

const bash={command:'/bin/bash',args:['--login'],env:{LANG:'C.UTF-8'},shellType:'unix' as const}

test('POSIX shells start the AI CLI inside an interactive login shell',()=>{
    const launch=shellCommand(bash,['/home/alice/.nvm/bin/codex','--sandbox','danger-full-access'])
    assert.equal(launch.command,'/bin/bash')
    assert.deepEqual(launch.args,['--login','-i','-c',`exec '/home/alice/.nvm/bin/codex' '--sandbox' 'danger-full-access'`])
    assert.equal(launch.shellType,'unix')
    assert.match(shellCommandLine(launch),/--login/)
})

test('interactive flags and command separators are not duplicated',()=>{
    assert.deepEqual(shellCommand({...bash,args:['--login','-i']},['codex']).args,
        ['--login','-i','-c',`exec 'codex'`])
    assert.deepEqual(shellCommand({...bash,args:['-l','-li','-c','legacy']},['codex']).args,
        ['-l','-li','-c',`exec 'codex'`])
})

test('macOS and Linux shells keep their own profile arguments',()=>{
    const zsh=shellCommand({command:'/bin/zsh',args:['--login'],shellType:'unix'},['codex','--model','gpt-5'])
    assert.deepEqual(zsh.args,['--login','-i','-c',`exec 'codex' '--model' 'gpt-5'`])
    const fish=shellCommand({command:'/usr/bin/fish',args:['-l'],shellType:'unix'},['codex'])
    assert.deepEqual(fish.args,['-l','-i','-c',`exec 'codex'`])
})

test('PowerShell profiles use -Command with PowerShell quoting and keep initialization',()=>{
    const launch=shellCommand({command:'C:\\Program Files\\PowerShell\\7\\pwsh.exe',args:['-nologo'],shellType:'powershell'},
        ['C:\\Program Files\\nodejs\\codex.cmd','--flag','a b',"O'Reilly"])
    assert.deepEqual(launch.args,['-nologo','-Command',
        `& 'C:\\Program Files\\nodejs\\codex.cmd' '--flag' 'a b' 'O''Reilly'`])
    assert.equal(launch.shellType,'powershell')
    const initialized=shellCommand({command:'powershell.exe',args:['-nologo','-noexit','-Command','Invoke-Expression profile.ps1'],shellType:'powershell'},['codex'])
    assert.deepEqual(initialized.args,['-nologo','-Command',`Invoke-Expression profile.ps1; & 'codex'`])
})

test('CMD profiles use /c and retain /k initialization',()=>{
    const launch=shellCommand({command:'cmd.exe',args:[],shellType:'cmd'},['codex','--flag','a b'])
    assert.deepEqual(launch.args,['/s','/c','codex --flag "a b"'])
    assert.equal(launch.shellType,'cmd')
    const initialized=shellCommand({command:'cmd.exe',args:['/k','C:\\Program Files\\Microsoft Visual Studio\\VsDevCmd.bat'],shellType:'cmd'},['codex'])
    assert.deepEqual(initialized.args,['/s','/c','"C:\\Program Files\\Microsoft Visual Studio\\VsDevCmd.bat" && codex'])
})

test('Windows Git Bash, MSYS2 and WSL profiles are routed to their real shell',()=>{
    const gitBash=shellCommand({command:'C:\\Program Files\\Git\\bin\\bash.exe',args:['--login','-i'],shellType:'unix'},['codex','--flag'])
    assert.deepEqual(gitBash.args,['--login','-i','-c',`exec 'codex' '--flag'`])
    const msys2=shellCommand({command:'C:\\msys64\\msys2_shell.cmd',args:['-no-start','-mingw64'],shellType:'unix'},['codex'])
    assert.deepEqual(msys2.args,['-no-start','-mingw64','-c',`exec 'codex'`])
    const wsl=shellCommand({command:'C:\\Windows\\System32\\wsl.exe',args:['-d','Ubuntu'],shellType:'unix'},['codex','--flag'])
    assert.deepEqual(wsl.args,['-d','Ubuntu','--exec','bash','-l','-i','-c',`exec 'codex' '--flag'`])
})

test('saved older shell invocations are rewritten with the same wrapper',()=>{
    const unix=replaceShellArguments({command:'/bin/bash',args:['--login','-c','codex','--old'],env:{},shellType:'unix'},['codex','--new'])
    assert.deepEqual(unix.args,['--login','-c',`exec 'codex' '--new'`])
    const powershell=replaceShellArguments({command:'pwsh.exe',args:['-nologo','-Command','codex --old'],env:{},shellType:'powershell'},['codex','--new'])
    assert.deepEqual(powershell.args,['-nologo','-Command',`& 'codex' '--new'`])
    const cmd=replaceShellArguments({command:'cmd.exe',args:['/c','codex --old'],env:{},shellType:'cmd'},['codex','--new'])
    assert.deepEqual(cmd.args,['/c','codex --new'])
})

test('shell environment is additive and plugin values override duplicate names',()=>{
    assert.deepEqual(shellEnvironment({...bash,env:{PATH:'/nvm/bin:/usr/bin',LANG:'en_US.UTF-8'}},{
        PATH:'/plugin/bin:/nvm/bin:/usr/bin',ARW_WORKSPACE_ROOT:'/project',HTTPS_PROXY:'http://127.0.0.1:7897'
    }),{PATH:'/plugin/bin:/nvm/bin:/usr/bin',LANG:'en_US.UTF-8',ARW_WORKSPACE_ROOT:'/project',HTTPS_PROXY:'http://127.0.0.1:7897'})
    assert.deepEqual(shellEnvironment({...bash,env:{path:'/shell',Path:'/mixed'}},{PATH:'/plugin'}),{PATH:'/plugin'})
})

test('settings list only usable local shell profiles and require an explicit selection',()=>{
    const shells=selectableShells([
        {id:'local:default',name:'Bash',type:'local',isBuiltin:true,options:{command:'/bin/bash',args:['--login'],env:{LANG:'C.UTF-8'},shellType:'unix'}},
        {id:'local:fish',name:'Fish',type:'local',options:{command:'/usr/bin/fish',args:[],env:{}}},
        {id:'ssh:1',name:'Server',type:'ssh',options:{command:'/bin/bash'}},
    ])
    assert.deepEqual(shells.map(shell=>shell.id),['local:default','local:fish'])
    assert.throws(()=>configuredShell(undefined),/选择启动 Shell/)
    assert.throws(()=>configuredShell({}),/选择启动 Shell/)
    assert.deepEqual(configuredShell(shells[1]),{id:'local:fish',name:'Fish',command:'/usr/bin/fish',args:[],env:{},shellType:null})
})
