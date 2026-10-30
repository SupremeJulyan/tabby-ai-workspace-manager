import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localWorkspace } from '../src/arw-tree/workspace'
import { topLevelItems, moveWorkspaceItem, deleteWorkspaceItem, renamedPath } from '../src/arw-tree/workspace-file-actions'

test('local move and rename preserve files, refuse collisions and reject recursive moves',async()=>{
    const root=await mkdtemp(join(tmpdir(),'arw-file-actions-'))
    try{
        const workspace=localWorkspace(root)
        await mkdir(join(root,'folder'));await mkdir(join(root,'destination'))
        await writeFile(join(root,'folder','data'),'original');await writeFile(join(root,'existing'),'keep')
        assert.deepEqual(topLevelItems(workspace,['folder/data','folder','folder']),[join(root,'folder')])
        await assert.rejects(moveWorkspaceItem(workspace,'folder','folder/child'),/itself/)
        await assert.rejects(moveWorkspaceItem(workspace,'folder/data','existing'),/already exists/)
        await moveWorkspaceItem(workspace,'folder','destination/folder')
        await moveWorkspaceItem(workspace,'destination/folder/data',renamedPath(workspace,'destination/folder/data',"it's data"))
        assert.equal(await readFile(join(root,'destination/folder',"it's data"),'utf8'),'original')
        await assert.rejects(deleteWorkspaceItem(workspace,'.'),/inside/)
        await assert.rejects(deleteWorkspaceItem(workspace,'../outside'),/inside/)
        assert.throws(()=>renamedPath(workspace,'existing','../escape'),/valid/)
        await deleteWorkspaceItem(workspace,'destination/folder')
        await assert.rejects(readFile(join(root,'destination/folder',"it's data")),/ENOENT/)
        assert.equal(await readFile(join(root,'existing'),'utf8'),'keep')
    }finally{await rm(root,{recursive:true,force:true,maxRetries:5})}
})

test('local mutations reject paths through symlink directories outside the workspace',async t=>{
    if(process.platform==='win32'){t.skip('requires POSIX symlinks');return}
    const root=await mkdtemp(join(tmpdir(),'arw-file-boundary-'))
    try{
        await mkdir(join(root,'workspace'));await mkdir(join(root,'outside'))
        await writeFile(join(root,'outside/data'),'keep')
        await symlink(join(root,'outside'),join(root,'workspace/link'))
        const workspace=localWorkspace(join(root,'workspace'))
        await assert.rejects(deleteWorkspaceItem(workspace,'link/data'),/symbolic link/)
        assert.equal(await readFile(join(root,'outside/data'),'utf8'),'keep')
    }finally{await rm(root,{recursive:true,force:true,maxRetries:5})}
})

test('remote move and delete validate canonical paths and preserve same-name destinations',async t=>{
    if(process.platform==='win32'){t.skip('remote host commands require POSIX');return}
    const root=await mkdtemp(join(tmpdir(),'arw-remote-actions-'))
    try{
        const workspace={...localWorkspace(root),kind:'remote' as const}
        await mkdir(join(root,'folder'));await writeFile(join(root,'folder',"it's data"),'original')
        await writeFile(join(root,'keep'),'keep')
        await assert.rejects(moveWorkspaceItem(workspace,"folder/it's data",'keep'),/already exists/)
        await moveWorkspaceItem(workspace,'folder','renamed')
        assert.equal(await readFile(join(root,'renamed',"it's data"),'utf8'),'original')
        await deleteWorkspaceItem(workspace,'renamed')
        assert.equal(await readFile(join(root,'keep'),'utf8'),'keep')
        await assert.rejects(readFile(join(root,'renamed',"it's data")),/ENOENT/)
    }finally{await rm(root,{recursive:true,force:true,maxRetries:5})}
})
