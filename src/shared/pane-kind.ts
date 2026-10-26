export type WorkspacePaneKind = 'ai' | 'file'

type PaneProfile = {profile?:{options?:{env?:Record<string,string>}}}
type FilePane = {arwFilePane?:boolean}

export function isAiPane (tab:unknown):boolean {
    return Boolean((tab as PaneProfile|null)?.profile?.options?.env?.ARW_WORKSPACE_ROOT)
}

export function isFilePane (tab:unknown):boolean {
    return Boolean((tab as FilePane|null)?.arwFilePane)
}

export function workspacePaneKind (tab:unknown):WorkspacePaneKind|undefined {
    if(isAiPane(tab))return 'ai'
    if(isFilePane(tab))return 'file'
}
