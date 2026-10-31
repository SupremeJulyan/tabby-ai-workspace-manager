import { englishMessages } from './messages'

// The host supplies its resolved locale during module initialization.
let locale = 'zh-CN'
const listeners = new Set<()=>void>()

export function setArwLocale (value?:string|null): void {
    locale = value || 'en-US'
    for (const listener of listeners) listener()
}

export function observeArwLocale (listener:()=>void): ()=>void {
    listeners.add(listener)
    return ()=>{listeners.delete(listener)}
}

function translate (text:string): string {
    return /^zh(?:[-_]|$)/i.test(locale) ? text : englishMessages[text] ?? text
}

/** Translate only authored text; interpolated paths, names and output stay intact. */
export function t (text:string):string
export function t (parts:TemplateStringsArray,...values:unknown[]):string
export function t (text:string|TemplateStringsArray,...values:unknown[]):string {
    if(typeof text==='string')return translate(text)
    return text.reduce((result,part,index)=>result+translate(part)+(index<values.length?String(values[index]):''),'')
}
