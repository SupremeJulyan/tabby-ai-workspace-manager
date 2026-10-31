import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensurePdfPromiseSupport } from './pdf-promises';
ensurePdfPromiseSupport();

export interface PdfPage {
  getViewport(options:{scale:number}):{width:number;height:number};
  render(options:Record<string,unknown>):{promise:Promise<void>;cancel():void};
  cleanup():void;
}
export interface PdfDocument {numPages:number;getPage(page:number):Promise<PdfPage>;destroy():Promise<void>}
export interface PdfLoading {promise:Promise<PdfDocument>;destroy():Promise<void>;onPassword?:((callback:(password:string)=>void,reason:number)=>void)}
const pdfjs=require('pdfjs-dist/legacy/build/pdf.mjs');
let workerUrl:string|undefined;
export function openPdf(data:Uint8Array,assets=join(__dirname,'pdf-assets')):PdfLoading {
  if(typeof window!=='undefined'&&typeof Worker==='function'){
    workerUrl??=URL.createObjectURL(new Blob([readFileSync(join(assets,'pdf.worker.min.mjs'),'utf8')],{type:'text/javascript'}));
    pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  }else{
    (globalThis as any).pdfjsWorker={WorkerMessageHandler:require('pdfjs-dist/legacy/build/pdf.worker.mjs').WorkerMessageHandler};
  }
  const asset=(name:string)=>pathToFileURL(join(assets,name)+'/').href;
  class OfflineBinaryDataFactory {
    async fetch({kind,filename}:{kind:string;filename:string}):Promise<Uint8Array> {
      const directory:Record<string,string>={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'};
      if(!Object.hasOwn(directory,kind)||!filename||filename.startsWith('.')||!/^[a-zA-Z0-9_.-]+$/.test(filename))throw new Error('Invalid bundled PDF asset');
      return new Uint8Array(await readFile(join(assets,directory[kind],filename)));
    }
  }
  return pdfjs.getDocument({BinaryDataFactory:OfflineBinaryDataFactory,data:new Uint8Array(data),cMapUrl:asset('cmaps'),cMapPacked:true,standardFontDataUrl:asset('standard_fonts'),wasmUrl:asset('wasm'),iccUrl:asset('iccs'),
    useWorkerFetch:false,enableXfa:false,isOffscreenCanvasSupported:false,enableHWA:false,disableAutoFetch:true,isEvalSupported:false});
}
