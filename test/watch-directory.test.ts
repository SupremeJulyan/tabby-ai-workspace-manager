import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchLocalDirectory } from '../src/shared/watch-directory'

test('local visible-directory events wake the listener and abort cleanly', async context => {
    const root = await mkdtemp(join(tmpdir(), 'arw-watch-'))
    context.after(() => rm(root, { recursive: true, force: true }))
    const controller = new AbortController()
    let changes = 0, observed: () => void = () => {}
    const changed = new Promise<void>(resolve => { observed = resolve })
    const pending = watchLocalDirectory(root, () => { changes++; observed() }, error => assert.fail(error.message), controller.signal)
    await writeFile(join(root, 'created.txt'), 'created')
    await changed
    assert.ok(changes > 0)
    controller.abort()
    await pending
})

test('local watches do not recurse into unopened directory trees',async context=>{
    const {mkdir}=await import('node:fs/promises')
    const root=await mkdtemp(join(tmpdir(),'arw-watch-bounded-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    await mkdir(join(root,'unopened'))
    const controller=new AbortController()
    let changes=0
    const watching=watchLocalDirectory(root,()=>{changes++},error=>assert.fail(error.message),controller.signal)
    try{
        await writeFile(join(root,'unopened','file.txt'),'content')
        await new Promise(resolve=>setTimeout(resolve,50))
        assert.equal(changes,0)
    }finally{controller.abort();await watching}
})

test('local monitoring works in an Electron renderer with numeric browser timer handles',async context=>{
    const {readFileSync}=await import('node:fs')
    const {createRequire}=await import('node:module')
    const {runInNewContext}=await import('node:vm')
    const module={exports:{} as {watchLocalDirectory:typeof watchLocalDirectory}}
    let browserTimerCalls=0
    runInNewContext(readFileSync(new URL('../.build/shared/watch-directory.js',import.meta.url),'utf8'),{
        module,exports:module.exports,require:createRequire(import.meta.url),
        setInterval(){browserTimerCalls++;return 42},clearInterval(){},
    })
    const root=await mkdtemp(join(tmpdir(),'arw-watch-renderer-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const controller=new AbortController()
    let observed!:()=>void
    const changed=new Promise<void>(resolve=>{observed=resolve})
    const pending=module.exports.watchLocalDirectory(root,observed,error=>assert.fail(error.message),controller.signal)
    try{
        await writeFile(join(root,'created.txt'),'created')
        await Promise.race([changed,pending.then(()=>assert.fail('watch exited before an event'))])
        assert.equal(browserTimerCalls,0)
    }finally{controller.abort();await pending}
})
