import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

@Injectable()
export class ArwConfigProvider extends ConfigProvider {
    defaults = {
        omw: {
            agent: { command: 'codex', args: [] as string[], resumeArgs: null as string[]|null, proxyUrl: '', env: [] },
            projects: {},
        },
    }
}
