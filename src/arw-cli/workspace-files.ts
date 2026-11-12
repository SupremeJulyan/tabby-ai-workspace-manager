import type { Workspace } from '../arw-tree/workspace'
import { RemotePathGuard } from '../security/remote-path'

/** Reads may leave the workspace; CLI writes remain scoped to its root. */
export function cliWorkspaceFiles(workspace:Workspace):Pick<Workspace,'list'|'read'>&{write(path:string,content:string,expectedHash?:string,signal?:AbortSignal):ReturnType<Workspace['write']>} {
    if(workspace.kind!=='remote')return workspace
    const guard=new RemotePathGuard(workspace.root,(command,signal)=>workspace.run(command,signal))
    return {
        list:workspace.list.bind(workspace),
        read:workspace.read.bind(workspace),
        async write(path,content,expectedHash,signal){
            await guard.resolve(path,true,signal)
            if(!workspace.writeCli)throw new Error('Remote workspace does not support independent CLI writes')
            return workspace.writeCli(path,content,expectedHash,signal)
        },
    }
}
