import test from 'node:test'
import assert from 'node:assert/strict'
import { SPLIT_DIVIDER_STYLES } from '../src/shared/split-divider-styles'

test('split dividers match the sidebar thin line and thicker hover feedback without narrowing the drag targets',()=>{
    assert.match(SPLIT_DIVIDER_STYLES,/background:transparent!important/)
    assert.match(SPLIT_DIVIDER_STYLES,/\.h::after\{[^}]*width:1px/)
    assert.match(SPLIT_DIVIDER_STYLES,/\.v::after\{[^}]*height:1px/)
    assert.match(SPLIT_DIVIDER_STYLES,/pointer-events:none/)
    assert.match(SPLIT_DIVIDER_STYLES,/\.h\.active::after\{width:5px\}/)
    assert.match(SPLIT_DIVIDER_STYLES,/\.v\.active::after\{height:5px\}/)
    assert.match(SPLIT_DIVIDER_STYLES,/background:#73a9ed55/)
    assert.match(SPLIT_DIVIDER_STYLES,/currentColor 10%,transparent/)
    assert.doesNotMatch(SPLIT_DIVIDER_STYLES,/split-tab-spanner\.(?:h|v)\{/)
})
