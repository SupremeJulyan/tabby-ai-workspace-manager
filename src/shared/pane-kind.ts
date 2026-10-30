export type WorkspacePaneKind = 'ai' | 'file'

type PaneProfile = {profile?:{options?:{env?:Record<string,string>}}}
type FilePane = {arwFilePane?:boolean;workspace?:WorkspacePaneIdentity}

export interface WorkspacePaneIdentity {kind:'local'|'remote';root:string;host?:string;port?:number;user?:string}

const normalizedRoot=(root:string,kind:'local'|'remote')=>kind==='local'&&process.platform==='win32'?root.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase():root.replace(/\/$/,'')

export function paneMatchesWorkspace(tab:unknown,workspace:WorkspacePaneIdentity):boolean {
    const pane=tab as {workspace?:WorkspacePaneIdentity;profile?:{options?:{env?:Record<string,string>}}}|null
    let identity=(tab as {arwWorkspaceIdentity?:WorkspacePaneIdentity}|null)?.arwWorkspaceIdentity??pane?.workspace
    if(!identity){
        const env=pane?.profile?.options?.env
        if(!env?.ARW_WORKSPACE_ROOT)return false
        identity={kind:env.ARW_WORKSPACE_KIND==='remote'||env.ARW_LOCAL_WORKSPACE_ROOT?'remote':'local',root:env.ARW_WORKSPACE_ROOT,host:env.ARW_WORKSPACE_HOST,port:Number(env.ARW_WORKSPACE_PORT)||undefined,user:env.ARW_WORKSPACE_USER}
    }
    const root=normalizedRoot(workspace.root,workspace.kind),candidate=normalizedRoot(identity.root,identity.kind)
    const sameHost=workspace.kind==='local'||Boolean(workspace.host&&identity.host&&workspace.host===identity.host)
    const samePort=workspace.kind==='local'||(workspace.port??22)===(identity.port??22)
    const sameUser=workspace.kind==='local'||(workspace.user??'')===(identity.user??'')
    return identity.kind===workspace.kind&&sameHost&&samePort&&sameUser&&root===candidate
}

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
