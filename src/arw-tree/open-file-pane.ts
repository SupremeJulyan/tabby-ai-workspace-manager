import { paneLayout, selectStackedPane } from '../shared/pane-layout'
import { orderedFilePanes } from '../arw-ai-cli/collapsed-panes'
import { isFilePane } from '../shared/pane-kind'
import type { AppService, BaseTabComponent, SplitTabComponent, TabsService } from 'tabby-core'
import type { NewTabParameters } from 'tabby-core/typings/services/tabs.service'
import { tileWorkspacePanes } from '../arw-ai-cli/tiling'

function topLevelFor (app:AppService,tab:BaseTabComponent|null|undefined):BaseTabComponent|undefined {
    if(!tab||!app.tabs?.length)return
    const visited=new Set<BaseTabComponent>()
    while(!app.tabs.includes(tab)&&!visited.has(tab)){
        visited.add(tab)
        const parent=app.getParentTab(tab)
        if(!parent)break
        tab=parent
    }
    return app.tabs.includes(tab)?tab:undefined
}

/** Open a file inside the current split instead of creating another top-level tab. */
export async function openFilePane<T extends BaseTabComponent> (app:AppService,params:NewTabParameters<T>,source?:BaseTabComponent|null,layout='tiled',tabs?:Pick<TabsService,'create'>):Promise<T> {
    const anchor=topLevelFor(app,source??app.activeTab)
    if(!anchor||app.tabs.length===0)return app.openNewTab(params)
    const split=('getAllTabs' in anchor?anchor:app.getParentTab(anchor)??app.wrapAndAddTab(anchor)) as SplitTabComponent
    if(anchor!==split&&app.tabs.includes(anchor))app.removeTab(anchor)
    if(!tabs)throw new Error('File panes require Tabby TabsService')
    const file=tabs.create({...params,inputs:{...params.inputs,arwPaneLayout:paneLayout(layout)}})
    try{
        await split.add(file,null,'b')
    }catch(error){
        file.destroy()
        throw error
    }
    app.selectTab(split)
    selectStackedPane(split,'file',file,orderedFilePanes(split,split.getAllTabs().filter(isFilePane)))
    split.focus(file)
    tileWorkspacePanes(app,split,true)
    return file
}
