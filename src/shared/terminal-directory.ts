import type { BaseTerminalTabComponent } from 'tabby-terminal'
import { terminalDirectoryCommand } from './terminal-directory-command'
import { t } from './i18n'

/** Submit a plain directory change; the shell displays any failure itself. */
export async function changeTerminalDirectory(tab:BaseTerminalTabComponent<any>,root:string):Promise<void> {
    if(!tab.session?.open)throw new Error(t('终端尚未连接，无法切换目录'))
    tab.sendInput(terminalDirectoryCommand(tab,root)+'\r')
}
