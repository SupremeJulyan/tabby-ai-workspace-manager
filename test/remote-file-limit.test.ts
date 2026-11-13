import test from 'node:test'
import assert from 'node:assert/strict'
import { enforceRemoteFileLimit, rememberRemoteFiles, registerRemoteFileLimit, remoteFileLimit } from '../src/arw-tree/remote-file-limit'

test('remote file cap defaults to ten and closes oldest files across splits without touching local files',async()=>{
    const closed:number[]=[],files:any[]=[]
    const split:any={getAllTabs:()=>files}
    const app:any={tabs:[split],getParentTab:()=>split}
    const add=(id:number,kind='remote',allow=true)=>{const file:any={arwFilePane:true,workspace:{kind},canClose:async()=>allow,destroy(){closed.push(id);files.splice(files.indexOf(file),1)}};files.push(file);return file}
    add(-1,'local')
    for(let i=0;i<10;i++){add(i);rememberRemoteFiles(app)}
    // Moving or focusing an old pane must not reset its opening order.
    files.push(files.splice(1,1)[0])
    add(10);await enforceRemoteFileLimit(app)
    assert.deepEqual(closed,[0]);assert.equal(files.length,11)
    let limit=3;const unregister=registerRemoteFileLimit(app,()=>limit)
    await enforceRemoteFileLimit(app);assert.deepEqual(closed,[0,1,2,3,4,5,6,7]);assert.equal(files.length,4)
    limit=4;add(11);await enforceRemoteFileLimit(app);assert.equal(files.length,5)
    unregister()
    assert.equal(remoteFileLimit(undefined),10);assert.equal(remoteFileLimit(0),10);assert.equal(remoteFileLimit(2.5),10)
})
test('cancelling the oldest file close preserves unsaved content and stops eviction',async()=>{
    let destroyed=false
    const files:any[]=[{arwFilePane:true,workspace:{kind:'remote'},canClose:async()=>false,destroy(){destroyed=true}},{arwFilePane:true,workspace:{kind:'remote'}}]
    const app:any={tabs:[{getAllTabs:()=>files}]}
    registerRemoteFileLimit(app,()=>1)
    await enforceRemoteFileLimit(app)
    assert.equal(destroyed,false);assert.equal(files.length,2)
})
