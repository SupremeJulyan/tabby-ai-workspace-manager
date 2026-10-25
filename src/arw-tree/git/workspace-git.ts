import type { Workspace } from '../workspace'
import { RemoteGit, gitCommand } from './remote-git'
import { readBackgroundGit } from './background-git'

export function runWorkspaceGit(workspace:Workspace,args:string[],signal?:AbortSignal){
    return workspace.runGit?workspace.runGit(args,signal):workspace.run(gitCommand(args),signal)
}

export function workspaceGit(workspace:Workspace,signal?:AbortSignal,background=false):RemoteGit {
    if(workspace.runGit)return new RemoteGit({run:args=>background?readBackgroundGit(workspace,args,signal):workspace.runGit!(args,signal)})
    return new RemoteGit(command=>background?readBackgroundGit(workspace,command,signal):workspace.run(command,signal))
}
