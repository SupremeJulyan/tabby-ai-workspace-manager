import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextSearch } from '../src/arw-tree/text-search'

function fixture(initial:string){
    let text=initial,writable=true,edits=0
    const selection={start:0,end:0}
    const target={value:initial,selectionStart:0,selectionEnd:0,scrollHeight:200,clientHeight:100,scrollTop:0,
        focus(){},setSelectionRange(start:number,end:number){selection.start=start;selection.end=end}}
    const search=new TextSearch(()=>text,value=>{text=value;target.value=value},()=>target as unknown as HTMLTextAreaElement,
        ()=>undefined,()=>writable,()=>{},()=>{edits++})
    return {search,selection,get text(){return text},get edits(){return edits},set writable(value:boolean){writable=value},set text(value:string){text=value}}
}

test('find escapes literals, matches case optionally and navigates with wrapping',()=>{
    const item=fixture('A.b a.b axb')
    item.search.query='a.b';item.search.changed()
    assert.equal(item.search.matches.length,2)
    assert.deepEqual(item.selection,{start:0,end:3})
    item.search.navigate(-1);assert.equal(item.selection.start,4)
    item.search.navigate(1);assert.equal(item.selection.start,0)
    item.search.matchCase=true;item.search.changed();assert.equal(item.search.matches.length,1)
    item.search.query='not found';item.search.changed();assert.equal(item.search.count,'0 / 0')
})

test('whole-word matching respects Unicode letters, numbers and underscores',()=>{
    const item=fixture('cat cats _cat cat2 猫cat cat猫 cat!')
    item.search.query='cat';item.search.wholeWord=true;item.search.changed()
    assert.equal(item.search.matches.length,2)
})

test('regular expression captures and replacement syntax preserve literal and unmatched dollars',()=>{
    const item=fixture('x=12 y=34')
    item.search.regex=true;item.search.query='([a-z])=(\\d+)';item.search.replacement='$2:$1:$$:$&:$3'
    item.search.changed();item.search.replaceOne()
    assert.equal(item.text,'12:x:$:x=12:$3 y=34')
    const all=fixture('x=12 y=34');all.search.regex=true;all.search.query='(?<key>[a-z])=(\\d+)';all.search.replacement='$<key>:$2'
    all.search.changed();all.search.replaceAll();assert.equal(all.text,'x:12 y:34')
    const literal=fixture('x x');literal.search.query='x';literal.search.replacement='$&';literal.search.replaceAll()
    assert.equal(literal.text,'$& $&')
})

test('invalid regex and empty search never modify text, zero-width Unicode matches always advance',()=>{
    const item=fixture('😀a');item.search.regex=true;item.search.query='[';item.search.changed()
    assert.ok(item.search.error);item.search.replaceAll();assert.equal(item.text,'😀a')
    item.search.query='(?=.)';item.search.replacement='|';item.search.changed()
    assert.equal(item.search.matches.length,2);item.search.replaceAll();assert.equal(item.text,'|😀|a')
    item.search.query='';item.search.replaceAll();assert.equal(item.text,'|😀|a')
})

test('replacement handles multiline text and does not re-replace inserted matches',()=>{
    const item=fixture('a\nb\na\nb')
    item.search.query='a\nb';item.search.replacement='a\nb\nc';item.search.replaceAll()
    assert.equal(item.text,'a\nb\nc\na\nb\nc')
})

test('read-only previews hand off replacement without writing and disabled editors cannot replace',()=>{
    const item=fixture('abc');item.search.query='a';item.search.replacement='x';item.search.changed()
    item.writable=false;item.search.open(true);assert.equal(item.edits,1)
    item.search.replaceOne();item.search.replaceAll();assert.equal(item.text,'abc')
})

test('replace refreshes stale matches before modifying text and caps large result sets',()=>{
    const item=fixture('abc');item.search.query='a';item.search.replacement='x';item.search.changed()
    item.text='zzz';item.search.replaceOne();assert.equal(item.text,'zzz')
    item.text='a'.repeat(10001);item.search.changed();assert.equal(item.search.matches.length,10000);assert.equal(item.search.limited,true)
    item.search.replaceAll();assert.equal(item.text,'a'.repeat(10001))
})

test('keyboard shortcuts support find, replace, next/previous and Escape',()=>{
    const item=fixture('abc abc');item.search.query='abc'
    const key=(key:string,ctrlKey=false,shiftKey=false)=>{
        let prevented=false,stopped=false
        item.search.key({key,ctrlKey,shiftKey,metaKey:false,preventDefault(){prevented=true},stopPropagation(){stopped=true}} as KeyboardEvent)
        assert.equal(prevented,true);assert.equal(stopped,true)
    }
    key('f',true);assert.equal(item.search.visible,true)
    key('F3');assert.equal(item.search.current,1)
    key('F3',false,true);assert.equal(item.search.current,0)
    key('h',true);assert.equal(item.search.replaceVisible,true)
    key('Escape');assert.equal(item.search.visible,false)
    item.search.destroy()
})
