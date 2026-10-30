import test from 'node:test'
import assert from 'node:assert/strict'
import { FileSelection } from '../src/arw-tree/file-selection'

test('Ctrl toggles individual rows; Shift selects visible ranges in either direction',()=>{
    const selection=new FileSelection(),rows=['a','b','c','d']
    selection.select('b',rows)
    selection.select('d',rows,true)
    assert.deepEqual([...selection.paths],['b','d'])
    selection.select('b',rows,true)
    assert.deepEqual([...selection.paths],['d'])
    selection.select('d',rows)
    selection.select('b',rows,false,true)
    assert.deepEqual([...selection.paths],['b','c','d'])
    selection.select('c',rows,false,true)
    assert.deepEqual([...selection.paths],['c','d'])
    selection.clear()
    selection.select('a',rows,false,true)
    assert.deepEqual([...selection.paths],['a'])
})

test('Ctrl+Shift adds a range without selecting filtered out entries',()=>{
    const selection=new FileSelection()
    selection.select('a',['a','b','c','d'])
    selection.select('c',['a','c','d'],true)
    selection.select('d',['a','c','d'],true,true)
    assert.deepEqual([...selection.paths],['a','c','d'])
})
