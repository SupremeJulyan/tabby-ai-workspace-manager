import { ProfilesService, TabRecoveryProvider, type BaseTabComponent, type RecoveryToken } from 'tabby-core'
import { Injectable, Injector } from '@angular/core'
import { restoredWorkspaceProfile } from '../shared/workspace-recovery'

@Injectable()
export class WorkspaceRecoveryProvider extends TabRecoveryProvider<BaseTabComponent> {
    constructor(private injector:Injector){super()}
    async applicableTo(token:RecoveryToken):Promise<boolean>{
        return token.type==='arw-workspace:ssh'||token.type==='arw-workspace:local'
    }
    async recover(token:RecoveryToken){
        const profile=token.profile
        if(!profile||token.type!==`arw-workspace:${profile.type}`||typeof profile.options?.arwWorkspace?.root!=='string')
            throw new Error('Invalid workspace recovery token')
        // Supply cwd/login scripts before the host creates and starts the session.
        const prepared=restoredWorkspaceProfile(profile)
        const parameters=await this.injector.get(ProfilesService).newTabParametersForProfile(prepared)
        if(!parameters)throw new Error('Workspace profile provider is unavailable')
        const resolved=parameters.inputs?.profile??prepared
        return {...parameters,inputs:{...parameters.inputs,profile:{...resolved,options:{...resolved.options,arwWorkspace:prepared.options.arwWorkspace}},savedState:token.savedState}}
    }
}
