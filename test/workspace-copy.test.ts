import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localWorkspace } from '../src/arw-tree/workspace'
import { pasteWorkspaceItem } from '../src/arw-tree/workspace-copy'

test('copy between local workspaces handles files and directories without overwrite',async()=>{
    const root=await mkdtemp(join(tmpdir(),'arw-copy-'))
    try{
        const from=join(root,'from'),to=join(root,'to')
        await mkdir(join(from,'folder'),{recursive:true});await mkdir(to)
        await writeFile(join(from,'folder','data.bin'),Buffer.from([0,1,255]))
        const source=localWorkspace(from),target=localWorkspace(to)
        await pasteWorkspaceItem({workspace:source,path:join(from,'folder'),hostKey:'local'},target,'.','local')
        assert.deepEqual(await readFile(join(to,'folder','data.bin')),Buffer.from([0,1,255]))
        await assert.rejects(pasteWorkspaceItem({workspace:source,path:join(from,'folder'),hostKey:'local'},target,'.','local'))
        await assert.rejects(pasteWorkspaceItem({workspace:source,path:join(from,'folder'),hostKey:'local'},target,'.','other'),/same host/)
    }finally{await rm(root,{recursive:true,force:true})}
})

test('remote copy uses quoted host command and rejects different host identity',async()=>{
    const commands:string[]=[]
    const target:any={kind:'remote',root:'/target',host:'server',async run(command:string){commands.push(command);return {exitCode:0,stdout:'',stderr:''}}}
    const source:any={kind:'remote',root:'/source',host:'server'}
    await pasteWorkspaceItem({workspace:source,path:"/source/it's file",hostKey:'server:alice'},target,'nested','server:alice')
    assert.match(commands[0],/cp -a -n -T/)
    assert.match(commands[0],/target\/nested/)
    await assert.rejects(pasteWorkspaceItem({workspace:source,path:'/source/file',hostKey:'server:bob'},target,'.','server:alice'),/same host/)
    assert.equal(commands.length,1)
})
