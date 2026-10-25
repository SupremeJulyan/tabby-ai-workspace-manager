import { t } from '../shared/i18n'
import * as TabbySSH from 'tabby-ssh'
import type { BaseTabComponent } from 'tabby-core'
import type { SSHTabComponent } from 'tabby-ssh/typings/components/sshTab.component'

// The published runtime exports this class; its entry declaration omits it.
// Keep the version-specific type path and runtime check confined to this adapter.
export type { SSHTabComponent }
export type SSHSession = NonNullable<SSHTabComponent['sshSession']>
const SSHHost = (TabbySSH as unknown as { SSHTabComponent?: new (...args: any[]) => SSHTabComponent }).SSHTabComponent

export function isSshTab (tab: BaseTabComponent): tab is SSHTabComponent {
    return typeof SSHHost === 'function' && tab instanceof SSHHost
}

export function requireSshCompatibility (): void {
    if (typeof SSHHost !== 'function') {
        throw new Error(t('ARW：当前 Tabby SSH 插件缺少 SSHTabComponent，请升级至兼容版本。'))
    }
}
