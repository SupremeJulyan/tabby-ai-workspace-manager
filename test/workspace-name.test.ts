import assert from 'node:assert/strict'
import test from 'node:test'
import { aiPaneTitle, leafName, titleAiTabs, titleTerminalTab, workspaceNames } from '../src/shared/workspace-name'

test('workspace names keep the leaf and expand only duplicate trailing paths',()=>{
    assert.equal(leafName('/home/user/tabby-ai-workspace-manager/'),'tabby-ai-workspace-manager')
    assert.equal(leafName('C:\\\\work\\\\project'),'project')
    assert.deepEqual(workspaceNames([
        {kind:'local',root:'/home/user/tabby-ai-workspace-manager'},
        {kind:'remote',root:'/srv/tabby-ai-workspace-manager'},
    ]),['local->tabby-ai-workspace-manager','remote->tabby-ai-workspace-manager'])
    assert.deepEqual(workspaceNames([
        {kind:'remote',root:'/srv/c2_tests'},
        {kind:'remote',root:'/opt/c2_tests'},
        {kind:'remote',root:'/mnt/c2_tests'},
    ]),['remote->srv/c2_tests','remote->opt/c2_tests','remote->mnt/c2_tests'])
})

test('AI tab titles derive kind and leaf from runtime environment and retitle duplicates',()=>{
    const tabs=Array.from({length:2},()=>({title:'old',profile:{name:'absolute profile name',options:{env:{ARW_WORKSPACE_ROOT:'/srv/c2_tests',ARW_WORKSPACE_NAME:'remote->c2_tests',ARW_WORKSPACE_KIND:'remote'}}}}))
    titleAiTabs(tabs)
    assert.deepEqual(tabs.map(aiPaneTitle),['remote->c2_tests','remote->c2_tests'])
    assert.deepEqual(tabs.map(tab=>tab.title),['old','old'])
    assert.equal(tabs[0].profile.name,'absolute profile name')
    const local={title:'bash',profile:{options:{env:{ARW_WORKSPACE_ROOT:'/home/user/tabby-ai-workspace-manager',ARW_WORKSPACE_NAME:'tabby-ai-workspace-manager'}}}}
    const remote={title:'ssh',profile:{options:{env:{ARW_WORKSPACE_ROOT:'/srv/tabby-ai-workspace-manager',ARW_WORKSPACE_NAME:'tabby-ai-workspace-manager',ARW_WORKSPACE_KIND:'remote'}}}}
    titleAiTabs([local,remote])
    assert.equal(aiPaneTitle(local),'local->tabby-ai-workspace-manager')
    assert.equal(aiPaneTitle(remote),'remote->tabby-ai-workspace-manager')
    assert.equal(local.title,'bash')
    assert.equal(remote.title,'ssh')
})

test('AI titles hide the native custom-title overlay on creation and restore',()=>{
    const tab={title:'old',customTitle:'',customTitleVisible:true,
        profile:{name:'AI command',options:{env:{ARW_WORKSPACE_ROOT:'/srv/tests',ARW_WORKSPACE_KIND:'remote'}}},
        setCustomTitle(title:string){this.customTitle=title;this.customTitleVisible=true},
        setCustomTitleVisible(visible:boolean){this.customTitleVisible=visible}}
    titleAiTabs([tab])
    assert.equal(tab.title,'old')
    assert.equal(tab.customTitle,'AI command')
    assert.equal(aiPaneTitle(tab),'remote->tests')
    assert.equal(tab.customTitleVisible,false)
    tab.customTitleVisible=true
    titleAiTabs([tab])
    assert.equal(tab.customTitleVisible,false)
})

test('sidebar workspace names omit kind but keep parent disambiguation',()=>{
    for(const kind of ['local','remote'] as const){
        assert.deepEqual(workspaceNames([
            {kind,root:'/home/projects'},
            {kind,root:'/srv/tests'},
            {kind,root:'/opt/tests'},
        ],false),['projects','srv/tests','opt/tests'])
    }
})

test('restored remote AI tabs use placeholder metadata even without a kind field',()=>{
    const legacy={title:'old',profile:{options:{env:{ARW_WORKSPACE_ROOT:'/home/share/user/HW_TESTS',ARW_LOCAL_WORKSPACE_ROOT:'/config/omw/agent-cwd/server/hash'}}}}
    const restored={title:'old',profile:{options:{cwd:'C:\\Tabby\\omw\\agent-cwd\\server\\hash',env:{ARW_WORKSPACE_ROOT:'/srv/c2_tests',ARW_WORKSPACE_KIND:'local'}}}}
    titleAiTabs([legacy,restored])
    assert.equal(aiPaneTitle(legacy),'remote->HW_TESTS')
    assert.equal(aiPaneTitle(restored),'remote->c2_tests')
})

test('terminal labels stay at the profile name while file labels remain untouched',()=>{
    const terminal={title:'shell cwd',customTitle:'remote:old',profile:{name:'Production'}}
    titleTerminalTab(terminal)
    assert.equal(terminal.customTitle,'Production')
    terminal.title='/another/cwd'
    titleTerminalTab(terminal)
    assert.equal(terminal.customTitle,'Production')
    const file={title:'notes.md ●',customTitle:'notes.md ●'}
    titleTerminalTab(file)
    assert.equal(file.title,'notes.md ●')
    assert.equal(file.customTitle,'notes.md ●')
})
