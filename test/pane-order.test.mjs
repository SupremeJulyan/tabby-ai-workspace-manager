import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const require=createRequire(import.meta.url)
const modulePath=require.resolve('../.build/arw-ai-cli/collapsed-panes.js')
const {orderedPanes}=require(modulePath)

test('pane order survives workspace hiding and stays independent by split and group',()=>{
    const split={},first={},second={},third={}
    assert.deepEqual(orderedPanes(split,'file',[first,second]),[first,second])
    assert.deepEqual(orderedPanes(split,'file',[third]),[third])
    assert.deepEqual(orderedPanes(split,'file',[second,third,first]),[first,second,third])
    assert.deepEqual(orderedPanes(split,'ai',[second,first]),[second,first])
    assert.deepEqual(orderedPanes({},'file',[second,first]),[second,first])
})

test('pane ordering does not retain closed panes while their split remains alive',()=>{
    execFileSync(process.execPath,['--expose-gc','-e',`
        const assert=require('node:assert/strict');
        const {orderedPanes}=require(${JSON.stringify(modulePath)});
        const split={};
        function addPane(){
            const pane={};
            orderedPanes(split,'file',[pane]);
            return new WeakRef(pane);
        }
        const reference=addPane();
        (async()=>{
            for(let attempt=0;attempt<10;attempt++){
                await new Promise(resolve=>setImmediate(resolve));
                global.gc();
            }
            assert.equal(reference.deref(),undefined);
            assert.deepEqual(orderedPanes(split,'file',[]),[]);
        })().catch(error=>{console.error(error);process.exitCode=1});
    `],{stdio:'pipe'})
})
