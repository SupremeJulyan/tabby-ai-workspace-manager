import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { CODEX_FULL_ACCESS_ARGUMENTS } from './arw-ai-cli/defaults'

@Injectable()
export class ArwConfigProvider extends ConfigProvider {
    defaults = {
        omw: {
            agent: { command: 'codex', args: [...CODEX_FULL_ACCESS_ARGUMENTS] as string[], resumeArgs: null as string[]|null, proxyUrl: '', env: [] },
            projects: {},
        },
    }
}
