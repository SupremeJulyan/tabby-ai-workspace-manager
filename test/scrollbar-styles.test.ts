import test from 'node:test'
import assert from 'node:assert/strict'
import { SCROLLBAR_STYLES } from '../src/shared/scrollbar-styles'

test('sidebar, file panes and terminal viewports share thin transparent scrollbars',()=>{
    for(const selector of ['arw-tree *','arw-editor *','arw-preview *','split-tab .xterm-viewport'])assert.ok(SCROLLBAR_STYLES.includes(selector))
    assert.match(SCROLLBAR_STYLES,/scrollbar-width:thin;scrollbar-color:#7775 transparent/)
})

test('xterm scrollbar visuals do not change the slider drag geometry or visibility',()=>{
    assert.match(SCROLLBAR_STYLES,/\.vertical>\.slider::before\{[^}]*width:6px/)
    assert.match(SCROLLBAR_STYLES,/\.horizontal>\.slider::before\{[^}]*height:6px/)
    assert.match(SCROLLBAR_STYLES,/pointer-events:none;border-radius:999px;background:#7775/)
    assert.doesNotMatch(SCROLLBAR_STYLES,/\.slider\{[^}]*(?:width|height|opacity|display):/)
})
