import { localWorkspace, Workspace } from '../arw-tree/workspace'
import { executeCaptured } from '../shared/process'
import { withWslExecution } from './wsl-execution'
export { wslCommandPlan } from './wsl-execution'

export function terminalLocalWorkspace(root:string,terminal?:{profile?:any;session?:object|null},platform:NodeJS.Platform=process.platform,execute:typeof executeCaptured=executeCaptured):Workspace {
    return withWslExecution(localWorkspace(root),terminal,platform,execute)
}
