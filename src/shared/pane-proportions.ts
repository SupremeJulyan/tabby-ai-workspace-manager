export interface PaneProportions {
    workspaceWidth:number
    aiWidth:number
    fileHeight:number
    terminalHeight:number
}

export const DEFAULT_PANE_PROPORTIONS:PaneProportions={workspaceWidth:50,aiWidth:50,fileHeight:60,terminalHeight:40}
const readers=new WeakMap<object,()=>unknown>()

export function panePercentage(value:unknown,fallback:number):number {
    return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=99?value:fallback
}

export function paneProportions(value:unknown):PaneProportions {
    const settings=(value&&typeof value==='object'?value:{}) as Partial<PaneProportions>
    const workspaceWidth=panePercentage(settings.workspaceWidth,50)
    const fileHeight=panePercentage(settings.fileHeight,60)
    return {workspaceWidth,aiWidth:100-workspaceWidth,fileHeight,terminalHeight:100-fileHeight}
}

export function registerPaneProportions(app:object,read:()=>unknown):()=>void {
    readers.set(app,read)
    return ()=>{if(readers.get(app)===read)readers.delete(app)}
}

export function workspacePaneProportions(app:object):PaneProportions {
    return paneProportions(readers.get(app)?.())
}
