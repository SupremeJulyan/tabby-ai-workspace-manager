import { t } from '../shared/i18n'

export interface FindState {query:string;matchCase:boolean;wholeWord:boolean;regex:boolean;replaceVisible:boolean}
interface TextMatch {start:number;end:number;value:RegExpExecArray}

export class TextSearch {
    visible=false
    replaceVisible=false
    query=''
    replacement=''
    matchCase=false
    wholeWord=false
    regex=false
    matches:TextMatch[]=[]
    current=-1
    error=''
    limited=false
    private timer?:ReturnType<typeof setTimeout>
    constructor(private read:()=>string,private write:(text:string)=>void,
        private target:()=>HTMLTextAreaElement|undefined,private input:()=>HTMLInputElement|undefined,
        public canReplace:()=>boolean,private prepare:()=>void=()=>{},private edit?:()=>void){}
    get state():FindState{return {query:this.query,matchCase:this.matchCase,wholeWord:this.wholeWord,regex:this.regex,replaceVisible:this.replaceVisible}}
    get count():string{return `${this.current+1} / ${this.matches.length}${this.limited?'+':''}`}
    restore(state:FindState):void {Object.assign(this,state);this.open(state.replaceVisible)}
    open(replace=false):void {
        if(replace&&!this.canReplace()){this.edit?.();return}
        this.visible=true;this.replaceVisible=replace||this.replaceVisible;this.prepare()
        const target=this.target(),selected=target?.value.slice(target.selectionStart,target.selectionEnd)
        if(selected&&!selected.includes('\n'))this.query=selected
        this.changed()
        clearTimeout(this.timer)
        this.timer=setTimeout(()=>{this.input()?.focus();this.input()?.select();this.select(false)},0)
    }
    close():void {this.visible=false;clearTimeout(this.timer);this.target()?.focus()}
    destroy():void {clearTimeout(this.timer)}
    private expression():RegExp {
        const pattern=this.regex?this.query:this.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
        return new RegExp(pattern,this.matchCase?'gu':'giu')
    }
    changed(anchor=0):void {
        this.matches=[];this.current=-1;this.error='';this.limited=false
        if(!this.query)return
        try{
            const expression=this.expression(),text=this.read()
            let match:RegExpExecArray|null
            while((match=expression.exec(text))){
                const start=match.index,end=start+match[0].length
                if(!this.wholeWord||(!/[\p{L}\p{N}_]/u.test(text.slice(Math.max(0,start-2),start).match(/.$/u)?.[0]??'')&&!/[\p{L}\p{N}_]/u.test(text.slice(end,end+2).match(/^./u)?.[0]??''))){
                    if(this.matches.length===10000){this.limited=true;break}
                    this.matches.push({start,end,value:match})
                }
                if(!match[0].length)expression.lastIndex+=(text.codePointAt(expression.lastIndex)??0)>0xffff?2:1
            }
            if(this.matches.length){this.current=this.matches.findIndex(match=>match.start>=anchor);if(this.current<0)this.current=0;this.select(false)}
        }catch{this.error=t('无效的正则表达式')}
    }
    navigate(direction:number):void {
        if(!this.matches.length)return
        this.current=(this.current+direction+this.matches.length)%this.matches.length
        this.select(true)
    }
    private select(focus:boolean):void {
        const match=this.matches[this.current],target=this.target()
        if(!match||!target)return
        if(focus)target.focus({preventScroll:true})
        target.setSelectionRange(match.start,match.end)
        const text=this.read(),line=text.slice(0,match.start).split('\n').length-1
        const lineHeight=target.scrollHeight/Math.max(1,text.split('\n').length)
        target.scrollTop=Math.max(0,line*lineHeight-target.clientHeight/2)
    }
    private substitute(match:TextMatch,text:string):string {
        if(!this.regex)return this.replacement
        return this.replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g,(original,key:string)=>{
            if(key==='$')return '$'
            if(key==='&')return match.value[0]
            if(key==='`')return text.slice(0,match.start)
            if(key==="'")return text.slice(match.end)
            if(key.startsWith('<'))return match.value.groups?match.value.groups[key.slice(1,-1)]??'':original
            const index=Number(key)
            if(index>0&&index<match.value.length)return match.value[index]??''
            const first=Number(key[0])
            return key.length===2&&first>0&&first<match.value.length?(match.value[first]??'')+key[1]:original
        })
    }
    replaceOne():void {
        if(!this.canReplace())return
        const selected=this.matches[this.current]
        if(!selected)return
        const text=this.read()
        this.changed(selected.start)
        const match=this.matches[this.current]
        if(!match||match.start!==selected.start||match.end!==selected.end)return
        const replacement=this.substitute(match,text)
        this.write(text.slice(0,match.start)+replacement+text.slice(match.end))
        this.changed(match.start+replacement.length+(match.start===match.end?1:0))
        this.select(true)
    }
    replaceAll():void {
        if(!this.canReplace())return
        this.changed()
        if(this.error||!this.matches.length||this.limited)return
        const text=this.read(),parts:string[]=[]
        let offset=0
        for(const match of this.matches){parts.push(text.slice(offset,match.start),this.substitute(match,text));offset=match.end}
        parts.push(text.slice(offset));this.write(parts.join(''));this.changed()
    }
    key(event:KeyboardEvent):void {
        const command=event.ctrlKey||event.metaKey,key=event.key.toLowerCase()
        if(command&&(key==='f'||key==='h')){event.preventDefault();event.stopPropagation();this.open(key==='h')}
        else if(event.key==='F3'){event.preventDefault();event.stopPropagation();if(!this.visible)this.open();else this.navigate(event.shiftKey?-1:1)}
        else if(this.visible&&event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close()}
    }
}
