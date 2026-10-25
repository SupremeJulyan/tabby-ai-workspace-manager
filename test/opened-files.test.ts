import test from 'node:test'
import assert from 'node:assert/strict'
import { registerOpenedWorkspaceFile, refreshOpenedWorkspaceFiles } from '../src/services/opened-files.service'
import type { Workspace } from '../src/arw-tree/workspace'

test('workspace refresh includes scoped open files and unregisters closed files',async()=>{
    const workspace={kind:'remote',root:'/workspace',host:'server'} as Workspace
    const child={...workspace,root:'project',sourceWorkspace:workspace}
    let refreshed=0
    const remove=registerOpenedWorkspaceFile({workspace:child,filePath:'file',refresh:async()=>{refreshed++}})
    try {
        await refreshOpenedWorkspaceFiles(undefined,{...workspace,host:'other'})
        assert.equal(refreshed,0)
        await refreshOpenedWorkspaceFiles(undefined,workspace)
        assert.equal(refreshed,1)
        remove()
        await refreshOpenedWorkspaceFiles(undefined,workspace)
        assert.equal(refreshed,1)
    } finally {remove()}
})
