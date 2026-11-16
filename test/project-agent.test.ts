import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../src/arw-tree/project.store'
import { localWorkspace } from '../src/arw-tree/workspace'

test('selected AI is persisted with its workspace project',async t=>{
    const root=await mkdtemp(join(tmpdir(),'arw-project-agent-'))
    t.after(()=>rm(root,{recursive:true,force:true}))
    const config={store:{omw:{}},saves:0,async save(){this.saves++}}
    const store=new ProjectStore(config as any)
    const workspace=localWorkspace(root)
    const project=await store.add(workspace,root)
    assert.ok(project)
    await store.setAgent(workspace,project.id,'codex-config')
    assert.equal(config.saves,2)
    assert.equal(store.list(workspace)[0].agentId,'codex-config')
    assert.equal(new ProjectStore(config as any).list(workspace)[0].agentId,'codex-config')
})
