import { DEFAULT_PANE_PROPORTIONS } from './shared/pane-proportions'
import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

@Injectable()
export class ArwConfigProvider extends ConfigProvider {
    defaults = {
        omw: {
            fileLayout: 'stacked',
            smallScreen: false,
            remoteFileLimit: 10,
            aiLayout: 'tiled',
            paneProportions: {...DEFAULT_PANE_PROPORTIONS},
            projects: {},
            agent: null,
            agents: null,
            agentsConfigured: false,
            aiShell: null,
        },
    }
}
