import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewKind, imageMime, parseCsv, detectDelimiter, renderMarkdown, markdownImages, relativePreviewAsset, decodePreviewText } from '../src/arw-tree/preview/model';
import { localWorkspace } from '../src/arw-tree/workspace';

test('preview dispatch covers common image formats, PDF, Markdown and delimited tables',()=>{
  for(const ext of ['png','JPEG','gif','webp','bmp','svg','ico','avif','tif','tiff'])assert.equal(previewKind('a.'+ext),'image');
  for(const [path,kind] of [['a.PDF','pdf'],['README.md','markdown'],['a.markdown','markdown'],['a.csv','csv'],['a.TSV','csv']])assert.equal(previewKind(path),kind);
  assert.equal(previewKind('main.ts'),undefined);assert.equal(imageMime('a.svg'),'image/svg+xml');
});
test('CSV handles quoted delimiters, embedded newlines, escaped quotes and bounded pagination data',()=>{
  const source='\uFEFFName,Value,Note\r\nAlice,"a,b","line 1\nline 2"\r\nBob,"he said ""yes""",=1+1\r\n';
  assert.deepEqual(parseCsv(source).rows,[['Name','Value','Note'],['Alice','a,b','line 1\nline 2'],['Bob','he said "yes"','=1+1']]);
  assert.equal(detectDelimiter('"name;value",description'),' ,'.trim());
  assert.equal(detectDelimiter('one;two;three\n1;2;3'),';');
  assert.equal(detectDelimiter('one\ttwo\n1\t2'),'\t');
  assert.deepEqual(parseCsv('a,b,').rows,[['a','b','']]);
  assert.deepEqual(parseCsv('""').rows,[['']]);assert.deepEqual(parseCsv('').rows,[]);
  assert.throws(()=>parseCsv('a,"unclosed'),/未闭合/);
  assert.throws(()=>parseCsv('"value"junk,b'),/无效/);
  const bounded=parseCsv('a,b,c\n1,2,3\n4,5,6',',',2,2);
  assert.equal(bounded.truncated,true);assert.deepEqual(bounded.rows,[['a','b'],['1','2']]);
});
test('Markdown renders GFM without allowing active HTML or automatic remote resources',()=>{
  const html=renderMarkdown('# 标题\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![external](https://example.test/track.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n```js\nconst x = "<tag>"\n```');
  assert.match(html,/<h1 id="标题">/);assert.match(html,/<table>/);assert.match(html,/type="checkbox"/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script|href="javascript:|<img[^>]+https:/);
  const assets=new Map([['image.png','data:image/png;base64,AA==']]);
  assert.match(renderMarkdown('![local](image.png)',assets),/<img src="data:image\/png;base64,AA=="/);
  assert.deepEqual(markdownImages('![x](a.png)\n![x](a.png)\n![y](b.png)'),['a.png','b.png']);
  assert.equal(relativePreviewAsset('A/B/README.md','../image%20name.png'),'A/image name.png');
  assert.equal(relativePreviewAsset('README.md','https://example.test/x.png'),undefined);
  assert.equal(relativePreviewAsset('README.md','data:image/png;base64,AAAA'),undefined);
});
test('preview text decoding supports BOMs and never treats binary NULs as UTF-8',()=>{
  assert.deepEqual(decodePreviewText(Buffer.from('\uFEFF你好')),{text:'你好',encoding:'UTF-8'});
  assert.deepEqual(decodePreviewText(Buffer.concat([Buffer.from([255,254]),Buffer.from('a,b\n1,2','utf16le')])),{text:'a,b\n1,2',encoding:'UTF-16 LE'});
  assert.throws(()=>decodePreviewText(new Uint8Array([0,1,2])),/文本/);
});
test('binary preview reads preserve data and enforce actual byte limits and workspace boundaries',async t=>{
  const root=await mkdtemp(join(tmpdir(),'arw-preview-read-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const bytes=Buffer.alloc(2*1024*1024,0x81);bytes[0]=0;
  await writeFile(join(root,'binary'),bytes);const workspace=localWorkspace(root);
  assert.deepEqual(Buffer.from(await workspace.readBytes!('binary',3*1024*1024)),bytes);
  await assert.rejects(workspace.readBytes!('binary',1024),/预览上限/);
  await assert.rejects(workspace.readBytes!('../outside',1024),/outside/);
  const controller=new AbortController();controller.abort();await assert.rejects(workspace.readBytes!('binary',3*1024*1024,controller.signal));
});


test('PDF Promise compatibility supports the older Promise constructor used by Tabby Zone.js',async()=>{
    const {ensurePdfPromiseSupport}=await import('../src/arw-tree/preview/pdf-promises')
    class ZoneLikePromise<T> extends Promise<T>{}
    Object.defineProperty(ZoneLikePromise,'withResolvers',{value:undefined,configurable:true})
    Object.defineProperty(ZoneLikePromise,'try',{value:undefined,configurable:true})
    ensurePdfPromiseSupport(ZoneLikePromise)
    const constructor=ZoneLikePromise as any
    const result=constructor.withResolvers();assert.ok(result.promise instanceof ZoneLikePromise)
    result.resolve(42);assert.equal(await result.promise,42)
    assert.equal(await constructor.try((a:number,b:number)=>a+b,2,3),5)
    await assert.rejects(constructor.try(()=>{throw new Error('callback failed')}),/callback failed/)
    const method=constructor.withResolvers;ensurePdfPromiseSupport(ZoneLikePromise)
    assert.equal(constructor.withResolvers,method)
})
