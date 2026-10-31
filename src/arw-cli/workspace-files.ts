import type { Workspace } from '../arw-tree/workspace'
import { RemotePathGuard } from '../security/remote-path'

/** Reads may leave the workspace; CLI writes remain scoped to its root. */
export function cliWorkspaceFiles(workspace:Workspace):Pick<Workspace,'list'|'read'|'write'> {
    if(workspace.kind!=='remote')return workspace
    const guard=new RemotePathGuard(workspace.root,(command,signal)=>workspace.run(command,signal))
    return {
        list:workspace.list.bind(workspace),
        read:workspace.read.bind(workspace),
        async write(path,content,expectedHash){
            await guard.resolve(path,true)
            return workspace.write(path,content,expectedHash)
        },
    }
}
