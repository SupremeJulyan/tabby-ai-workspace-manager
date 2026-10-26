import { DEFAULT_PANE_PROPORTIONS } from './shared/pane-proportions'
import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { CODEX_FULL_ACCESS_ARGUMENTS } from './arw-ai-cli/defaults'

@Injectable()
export class ArwConfigProvider extends ConfigProvider {
    defaults = {
        omw: {
            fileLayout: 'tiled',
            aiLayout: 'tiled',
            paneProportions: {...DEFAULT_PANE_PROPORTIONS},
            agent: { command: 'codex', args: [...CODEX_FULL_ACCESS_ARGUMENTS] as string[], resumeArgs: null as string[]|null, proxyUrl: '', shell: null },
            projects: {},
        },
    }
}
