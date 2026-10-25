import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleTypography, terminalFont } from '../src/arw-tree/fonts'
import { TREE_STYLES } from '../src/arw-tree/tree.view'
import { EDITOR_STYLES } from '../src/arw-tree/editor.view'

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
