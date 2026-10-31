/** Paths survive directory refreshes; range selection follows the visible tree order. */
export class FileSelection {
    readonly paths=new Set<string>()
    private anchor?:string
    clear():void {this.paths.clear();this.anchor=undefined}
    select(path:string,visible:string[],toggle=false,range=false):void {
        const start=this.anchor?visible.indexOf(this.anchor):-1,end=visible.indexOf(path)
        if(range&&start>=0&&end>=0){
            if(!toggle)this.paths.clear()
            for(const item of visible.slice(Math.min(start,end),Math.max(start,end)+1))this.paths.add(item)
        }else{
            if(!toggle)this.paths.clear()
            if(toggle&&this.paths.has(path))this.paths.delete(path)
            else this.paths.add(path)
            this.anchor=path
        }
    }
}
