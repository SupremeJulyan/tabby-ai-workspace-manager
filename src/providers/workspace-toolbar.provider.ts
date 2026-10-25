import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton } from 'tabby-core'
import { SidebarService } from '../arw-tree/sidebar.service'

@Injectable()
export class WorkspaceToolbarProvider extends ToolbarButtonProvider {
    constructor(private sidebar:SidebarService){super()}
    provide():ToolbarButton[]{return [{title:'ai-workspace-manager',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>',weight:30,click:()=>this.sidebar.toggle()}]}
}
