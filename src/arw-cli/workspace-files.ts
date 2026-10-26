import type { Workspace } from '../arw-tree/workspace'
import { RemotePathGuard } from '../security/remote-path'

/** CLI paths are untrusted. Keep workspace scope checks out of interactive file I/O. */
export function cliWorkspaceFiles(workspace:Workspace):Pick<Workspace,'list'|'read'|'write'> {
    if(workspace.kind!=='remote')return workspace
    const guard=new RemotePathGuard(workspace.root,(command,signal)=>workspace.run(command,signal))
    return {
        async list(path,signal){
            await guard.resolveDirectory(path,signal)
            return workspace.list(path,signal)
        },
        async read(path,signal){
            await guard.resolve(path,false,signal)
            return workspace.read(path,signal)
        },
        async write(path,content,expectedHash){
            await guard.resolve(path,true)
            return workspace.write(path,content,expectedHash)
        },
    }
}
