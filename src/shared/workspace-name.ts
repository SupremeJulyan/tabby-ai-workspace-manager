export interface WorkspaceName {kind:'local'|'remote';root:string}

export function leafName (root:string):string {
    return root.replace(/[\\/]+$/,'').split(/[\\/]/).filter(Boolean).pop()??root
}

/** Short sibling-distinguishing name; equal trailing paths expand until they differ. */
export function workspaceNames (workspaces:WorkspaceName[],includeKind=true):string[] {
    const parts=workspaces.map(workspace=>workspace.root.replace(/[\\/]+$/,'').split(/[\\/]/).filter(Boolean))
    const depth=parts.map(()=>1)
    const key=(index:number)=>`${workspaces[index].kind}\0${parts[index].slice(-depth[index]).join('\0')}`
    for(;;){
        const groups=new Map<string,number[]>()
        parts.forEach((_,index)=>{
            const group=groups.get(key(index))??[]
            group.push(index)
            groups.set(key(index),group)
        })
        let changed=false
        for(const group of groups.values()){
            if(group.length<2)continue
            if(new Set(group.map(index=>parts[index].join('/'))).size===1)continue
            for(const index of group)if(depth[index]<parts[index].length){depth[index]++;changed=true}
        }
        if(!changed)break
    }
    return workspaces.map((workspace,index)=>`${includeKind?`${workspace.kind}->`:''}${parts[index].slice(-depth[index]).join('/')||leafName(workspace.root)}`)
}

export function inheritedWorkspaceName (kind:'local'|'remote',name:string):string {
    for(const prefix of [`${kind}->`,`${kind}:`])if(name.startsWith(prefix)&&name.length>prefix.length)return name.slice(prefix.length)
    return name
}

export interface NamedTab {title?:string;customTitle?:string;customTitleVisible?:boolean;setTitle?:(title:string)=>void;setCustomTitle?:(title:string)=>void;setCustomTitleVisible?:(visible:boolean)=>void;profile?:{name?:string;options?:{cwd?:string;env?:Record<string,string>}}}

const aiTitles=new WeakMap<NamedTab,string>()

export function aiPaneTitle(tab:NamedTab):string {
    return aiTitles.get(tab)??''
}

export function titleTerminalTab(tab:NamedTab,name=tab.profile?.name):void {
    if(!name)return
    if(tab.customTitle!==name){
        if(tab.setCustomTitle)tab.setCustomTitle(name)
        else tab.customTitle=name
    }
    if(tab.customTitleVisible!==false)tab.setCustomTitleVisible?.(false)
}

/** Keep runtime AI titles short and unique without changing saved profiles. */
export function titleAiTabs (tabs:NamedTab[]):void {
    const entries=tabs.flatMap(tab=>{
        const env=tab.profile?.options?.env
        if(!env?.ARW_WORKSPACE_ROOT)return []
        const placeholder=env.ARW_LOCAL_WORKSPACE_ROOT||tab.profile?.options?.cwd||''
        const kind:'local'|'remote'=env.ARW_WORKSPACE_KIND==='remote'||Boolean(env.ARW_LOCAL_WORKSPACE_ROOT)||/[\\/]agent-cwd[\\/]/.test(placeholder)?'remote':'local'
        const name=inheritedWorkspaceName(kind,env.ARW_WORKSPACE_NAME||env.ARW_WORKSPACE_ROOT)
        return [{tab,kind,root:env.ARW_WORKSPACE_ROOT,name}]
    })
    const titles=workspaceNames(entries)
    entries.forEach((entry,index)=>{
        aiTitles.set(entry.tab,titles[index])
        titleTerminalTab(entry.tab)
    })
}
