import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)

function pdfFixture(){
 const stream=text=>`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',stream('BT /F1 16 Tf 20 60 Td (ARW Preview) Tj ET'),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',stream('BT /F1 16 Tf 20 60 Td (Second page) Tj ET'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 let data='%PDF-1.4\n',offsets=[0]
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const start=Buffer.byteLength(data)
 data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
 return new Uint8Array(Buffer.from(data))
}
test('bundled offline PDF engine parses multiple pages and renders real pixels',async()=>{
 const canvas=require('@napi-rs/canvas')
 Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D})
 const engine=require('../dist/pdf-preview.cjs'),task=engine.openPdf(pdfFixture())
 try{
  const pdf=await task.promise;assert.equal(pdf.numPages,2)
  const page=await pdf.getPage(1),viewport=page.getViewport({scale:1}),surface=canvas.createCanvas(viewport.width,viewport.height)
  await page.render({canvas:surface,canvasContext:surface.getContext('2d'),viewport}).promise
  const pixels=surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data
  assert.ok(pixels.some((value,index)=>index%4!==3&&value<128),'PDF text must render onto the page')
  const second=await pdf.getPage(2);assert.equal((await second.getTextContent()).items[0].str,'Second page')
 }finally{await task.destroy()}
})
