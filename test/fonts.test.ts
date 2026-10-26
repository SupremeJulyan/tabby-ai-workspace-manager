import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleTypography, terminalFont } from '../src/arw-tree/fonts'
import { TREE_STYLES } from '../src/arw-tree/tree.view'
import { EDITOR_TEMPLATE, EDITOR_STYLES } from '../src/arw-tree/editor.view'
import { PREVIEW_TEMPLATE, PREVIEW_STYLES } from '../src/arw-tree/preview.view'

test('terminal font settings produce a safe sidebar family, size, and line height', () => {
    const font = terminalFont({
        font: 'Roboto Mono, "Noto Sans Mono", monospace',
        fallbackFont: 'Fira Code',
        fontSize: 18,
        linePadding: 1,
    })
    assert.equal(font.family, '"Roboto Mono", "Noto Sans Mono", "Fira Code", "monospace"')
    assert.equal(font.size, 16)
    assert.ok(font.height > 1.5 && font.height < 1.6)
    assert.deepEqual(terminalFont(), { family: '"monospace"', size: 12, height: 1.45 })
    assert.equal(terminalFont({ fontSize: 100 }).size, 30)
    assert.equal(terminalFont({ fontSize: 1 }).size, 7)
})

test('compact component typography scales from the Tabby terminal font variables', () => {
    const css = scaleTypography(':host{font-size:12px;line-height:1.45;font-family:inherit}textarea{font:12px/1.65 monospace}.small{font-size:10px!important}')
    assert.match(css, /font-size:var\(--arw-font-size,12px\)/)
    assert.match(css, /line-height:var\(--arw-line-height,1\.45\)/)
    assert.match(css, /font-family:var\(--arw-font-family,inherit\)/)
    assert.match(css, /font:var\(--arw-font-size,12px\)\/1\.65 var\(--arw-font-family,monospace\)/)
    assert.match(css, /font-size:calc\(var\(--arw-font-size,12px\) - 2px\)!important/)
    assert.doesNotMatch(TREE_STYLES, /font-size:\d+(?:\.\d+)?px/)
    assert.doesNotMatch(EDITOR_STYLES, /font-size:\d+(?:\.\d+)?px/)
})


test('file toolbar buttons scale with their pane rather than the application viewport',()=>{
    for(const styles of [EDITOR_STYLES,PREVIEW_STYLES]){
        assert.match(styles,/container-type:inline-size/)
        assert.match(styles,/font-size:clamp\(10px,3cqw,var\(--arw-font-size,12px\)\)/)
        assert.match(styles,/@container\(max-width:320px\)/)
        assert.match(styles,/padding:clamp\(3px,1cqw,6px\) clamp\(5px,2cqw,10px\)/)
    }
})


test('directory input and actions align with the indented workspace rows',()=>{
    assert.match(TREE_STYLES,/\.saved-workspaces\{[^}]*margin:0 10px 8px/)
    assert.match(TREE_STYLES,/\.project-row\{[^}]*gap:3px;[^}]*margin-left:12px/)
    assert.match(TREE_STYLES,/\.current-directory\{[^}]*gap:3px;[^}]*margin:0 10px 8px 22px/)
    assert.match(TREE_STYLES,/\.project-row>\.project-ai,\.project-row>\.icon-button,\.current-directory>\.icon-button\{flex:0 0 max\(26px/)
})

test('editor actions use hollow SVG icons without filled Bootstrap buttons',()=>{
    const header=EDITOR_TEMPLATE.slice(0,EDITOR_TEMPLATE.indexOf('</header>'))
    assert.equal((header.match(/class="file-icon-button"/g)??[]).length,4)
    assert.equal((header.match(/fill="none"/g)??[]).length,4)
    assert.equal((header.match(/aria-label/g)??[]).length,4)
    assert.doesNotMatch(header,/btn-primary|btn-secondary/)
})

test('every preview action uses an accessible hollow line icon',()=>{
    const buttons=[...PREVIEW_TEMPLATE.matchAll(/<button((?:[^>"']|"[^"]*"|'[^']*')*)>(.*?)<\/button>/gs)]
    assert.equal(buttons.filter(([,attributes])=>attributes.includes('class="file-icon-button"')).length,16)
    for(const [,attributes,body] of buttons.filter(([,attributes])=>attributes.includes('class="file-icon-button"'))){
        assert.match(attributes,/class="file-icon-button"/)
        assert.match(attributes,/\[title\]=/)
        assert.match(attributes,/aria-label/)
        assert.match(body,/fill="none"/)
        assert.match(body,/stroke="currentColor"/)
    }
})
