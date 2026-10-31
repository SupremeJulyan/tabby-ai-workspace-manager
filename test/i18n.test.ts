import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { setArwLocale, observeArwLocale, t } from '../src/shared/i18n'
import { englishMessages } from '../src/shared/messages'
import { TREE_TEMPLATE } from '../src/arw-tree/tree.view'
import { EDITOR_TEMPLATE } from '../src/arw-tree/editor.view'
import { PREVIEW_TEMPLATE } from '../src/arw-tree/preview.view'

test('Tabby Chinese locales use Chinese; English, other languages and missing locale use English',()=>{
    try {
        for(const locale of ['zh-CN','zh-TW','zh-Hans','zh_Hant','ZH-cn','zh']){
            setArwLocale(locale);assert.equal(t('保存'),'保存')
        }
        for(const locale of ['en-US','en-GB','ja-JP','fr-FR',undefined,null,'']){
            setArwLocale(locale);assert.equal(t('保存'),'Save');assert.equal(t('工作区：'),'Workspace: ')
        }
        const name='中文项目/保存/<test>'
        assert.equal(t`工作区：${name}`,`Workspace: ${name}`)
        assert.equal(t('custom path/中文'),'custom path/中文')
        assert.equal(t`还原“${name}”的未暂存更改？`,`Discard “${name}” unstaged changes?`)
        assert.equal(t('取消'),'Cancel')
    } finally {setArwLocale('zh-CN')}
})

test('locale observers update and detach',()=>{
    let updates=0
    const stop=observeArwLocale(()=>updates++)
    setArwLocale('en-US');setArwLocale('zh-CN');assert.equal(updates,2)
    stop();setArwLocale('en-US');assert.equal(updates,2);setArwLocale('zh-CN')
})

test('English catalogue contains no Chinese text and all Angular templates parse',async()=>{
    for(const [key,value] of Object.entries(englishMessages))assert.ok(!/[\u3400-\u9fff]/.test(value),key)
    const {parseTemplate}=await import('@angular/compiler')
    const settings=ts.createSourceFile('settings.ts',readFileSync('src/arw-ai-cli/settings.component.ts','utf8'),ts.ScriptTarget.Latest,true)
    let settingsTemplate=''
    function visit(node:ts.Node){
        if(ts.isPropertyAssignment(node)&&node.name.getText(settings)==='template'&&ts.isNoSubstitutionTemplateLiteral(node.initializer))settingsTemplate=node.initializer.text
        ts.forEachChild(node,visit)
    }
    visit(settings)
    for(const [name,template] of Object.entries({tree:TREE_TEMPLATE,editor:EDITOR_TEMPLATE,preview:PREVIEW_TEMPLATE,settings:settingsTemplate})){
        assert.ok(template,name)
        const result=parseTemplate(template,name)
        assert.equal(result.errors,null,result.errors?.map(error=>error.toString()).join('\n'))
        assert.ok(!/\[aria-label\]/.test(template),'ARIA labels must be attribute bindings')
    }
})
