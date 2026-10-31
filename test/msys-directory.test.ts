import test from 'node:test'
import assert from 'node:assert/strict'
import { isMsysTerminal, msysPathConverter, msysWorkspaceDirectory } from '../src/shared/msys-directory'

test('Git Bash and MSYS2 UCRT64 are recognized without matching SSH or PowerShell',()=>{
    for(const command of ['C:\\Program Files\\Git\\bin\\bash.exe','D:\\msys64\\usr\\bin\\bash.exe','D:\\msys64\\msys2_shell.cmd']){
        assert.equal(isMsysTerminal({profile:{type:'local',options:{command}}}),true)
    }
    assert.equal(isMsysTerminal({profile:{type:'ssh',options:{command:'bash'}}}),false)
    assert.equal(isMsysTerminal({profile:{type:'local',options:{command:'pwsh.exe'}}}),false)
})
test('cygpath is selected from the same Git or MSYS installation',()=>{
    assert.equal(msysPathConverter('C:\\Program Files\\Git\\bin\\bash.exe'),'C:\\Program Files\\Git\\usr\\bin\\cygpath.exe')
    assert.equal(msysPathConverter('D:\\msys64\\usr\\bin\\bash.exe'),'D:\\msys64\\usr\\bin\\cygpath.exe')
    assert.equal(msysPathConverter('D:\\msys64\\msys2_shell.cmd'),'D:\\msys64\\usr\\bin\\cygpath.exe')
    assert.throws(()=>msysPathConverter('bash'),/absolute path/)
})
test('MSYS drive roots and runtime paths are converted without shell interpolation',async()=>{
    for(const [root,windows] of [['/d','D:\\'],['/home/julyan','D:\\msys64\\home\\julyan'],["/d/a 'quoted' $(command)","D:\\a 'quoted' $(command)"]]){
        assert.equal(await msysWorkspaceDirectory(root,'D:\\msys64\\usr\\bin\\bash.exe',async(command,args)=>{
            assert.equal(command,'D:\\msys64\\usr\\bin\\cygpath.exe')
            assert.deepEqual(args,['-w','--',root])
            return windows+'\r\n'
        }),windows)
    }
})
test('invalid MSYS reports and conversion results are rejected',async()=>{
    await assert.rejects(msysWorkspaceDirectory('/d\ninvalid','D:\\msys64\\usr\\bin\\bash.exe',async()=>''),/Invalid MSYS/)
    await assert.rejects(msysWorkspaceDirectory('/d','D:\\msys64\\usr\\bin\\bash.exe',async()=>'/d\n'),/Invalid Windows/)
})
