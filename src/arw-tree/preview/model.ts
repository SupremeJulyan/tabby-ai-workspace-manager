import { textFileLimit } from '../../shared/text-file-limit'
import { t } from '../../shared/i18n'
import { Marked, Renderer } from 'marked';
import { workspacePath } from '../../shared/workspace-path';

export type PreviewKind='image'|'pdf'|'markdown'|'csv';
const images:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jpe:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',dib:'image/bmp',svg:'image/svg+xml',ico:'image/x-icon',avif:'image/avif',tif:'image/tiff',tiff:'image/tiff'};
export const extension=(path:string)=>path.split('.').pop()?.toLowerCase()??'';
export const imageMime=(path:string):string|undefined=>Object.hasOwn(images,extension(path))?images[extension(path)]:undefined;
export function previewKind(path:string):PreviewKind|undefined {
  if(imageMime(path))return 'image';
  const ext=extension(path);
  if(ext==='pdf')return 'pdf';
  if(['md','markdown','mdown','mkd'].includes(ext))return 'markdown';
  if(['csv','tsv'].includes(ext))return 'csv';
  return undefined;
}
export const previewMaxBytes=(kind:PreviewKind)=>({image:32*1024*1024,pdf:64*1024*1024,markdown:textFileLimit,csv:textFileLimit}[kind]);
export function decodePreviewText(bytes:Uint8Array):{text:string;encoding:string} {
  const decode=(encoding:string)=>new TextDecoder(encoding,{fatal:true}).decode(bytes);
  if(bytes[0]===0xff&&bytes[1]===0xfe)return {text:decode('utf-16le'),encoding:'UTF-16 LE'};
  if(bytes[0]===0xfe&&bytes[1]===0xff)return {text:decode('utf-16be'),encoding:'UTF-16 BE'};
  if(bytes.includes(0))throw new Error(t('文件不是可预览的文本格式'));
  try{return {text:decode('utf-8'),encoding:'UTF-8'}}catch{return {text:decode('gb18030'),encoding:'GB18030'}}
}
export const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
export function markdownImages(source:string):string[] {
  const parser=new Marked(),paths=new Set<string>();
  parser.walkTokens(parser.lexer(source),token=>{if(token.type==='image'&&paths.size<16)paths.add(token.href)});
  return [...paths];
}
export function relativePreviewAsset(path:string,href:string,kind:'local'|'remote'='remote',platform:NodeJS.Platform=process.platform):string|undefined {
  if(!href||href.length>4096||/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href))return undefined;
  try{
    const target=decodeURIComponent(href.split(/[?#]/)[0]);
    if(!target||/[\x00-\x1f\x7f]/.test(target))return undefined;
    const paths=workspacePath(kind,platform);
    return paths.isAbsolute(target)?target:paths.join(paths.dirname(path),target);
  }catch{return undefined}
}
export function renderMarkdown(source:string,assets:ReadonlyMap<string,string>=new Map()):string {
  const renderer=new Renderer();
  renderer.html=({text})=>escapeHTML(text);
  renderer.image=({href,text})=>{
    const data=assets.get(href);
    return data&&/^data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml|x-icon|avif);base64,/.test(data)
      ? `<img src="${escapeHTML(data)}" alt="${escapeHTML(text)}" />` : t`<span class="markdown-image">[图片：${escapeHTML(text||href)}]</span>`;
  };
  renderer.link=function({href,tokens}){
    const label=this.parser.parseInline(tokens);
    return /^(?:https?:|mailto:|#)/i.test(href)?`<a href="${escapeHTML(href)}" rel="noopener noreferrer">${label}</a>`:`<span>${label}</span>`;
  };
  renderer.heading=function({tokens,depth}){
    const label=this.parser.parseInline(tokens),slug=tokens.map(token=>'text' in token?token.text:'').join('').toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/\s+/g,'-');
    return `<h${depth} id="${escapeHTML(slug)}">${label}</h${depth}>`;
  };
  const html=new Marked({gfm:true,renderer}).parse(source,{async:false}) as string;
  if(html.length>32*1024*1024)throw new Error(t('Markdown 渲染结果过大'));
  return html;
}
export function detectDelimiter(source:string):string {
  const counts=new Map([[',',0],['\t',0],[';',0],['|',0]]);let quoted=false;
  for(let index=0;index<Math.min(source.length,65536);index++){
    const value=source[index];
    if(value==='"'){if(quoted&&source[index+1]==='"')index++;else quoted=!quoted}
    else if(!quoted){if(value==='\n'||value==='\r')break;if(counts.has(value))counts.set(value,counts.get(value)!+1)}
  }
  return [...counts].sort((a,b)=>b[1]-a[1])[0][0];
}
export interface CsvPreview {rows:string[][];truncated:boolean;columns:number}
export function parseCsv(input:string,delimiter=',',maxRows=10001,maxColumns=200):CsvPreview {
  if(![',','\t',';','|'].includes(delimiter))throw new Error(t('不支持的 CSV 分隔符'));
  const source=input.replace(/^\uFEFF/,''),rows:string[][]=[];let row:string[]=[],field='',state:'plain'|'quoted'|'closed'='plain',columns=0,count=0,truncated=false;
  const cell=()=>{count++;if(row.length<maxColumns)row.push(field);else truncated=true;field='';state='plain'};
  const record=()=>{cell();columns=Math.max(columns,count);rows.push(row);row=[];count=0};
  for(let index=0;index<source.length;index++){
    const value=source[index];
    if(state==='quoted'){
      if(value==='"'){if(source[index+1]==='"'){field+='"';index++}else state='closed'}else field+=value;
    }else if(value===delimiter)cell();
    else if(value==='\r'||value==='\n'){
      record();if(value==='\r'&&source[index+1]==='\n')index++;
      if(rows.length>=maxRows){truncated=index+1<source.length||truncated;break}
    }else if(value==='"'&&state==='plain'&&!field)state='quoted';
    else if(state==='closed'){if(!/[ \t]/.test(value))throw new Error(t('CSV 引号结束后存在无效字符'))}
    else field+=value;
  }
  if(state==='quoted')throw new Error(t('CSV 存在未闭合的引号'));
  if(rows.length<maxRows&&(field||row.length||state==='closed'))record();
  return {rows,truncated,columns:Math.min(columns,maxColumns)};
}
