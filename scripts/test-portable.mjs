import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd=fileURLToPath(new URL('../',import.meta.url))
const files=['platform-path','workspace-git','windows-cli','cli-lifecycle','user-cli','workspace','preview','text-search',
    'agent-cwd','ai-shell-launch','ai-recovery','file-pane-layout','stacked-pane-layout','ai-close-button','scrollbar-styles','split-divider','forwarding-server','network-error','open-adjacent-tab','opened-files','workspace-name','fonts']
const suites=[
    ['--import','tsx','--test',...files.map(name=>`test/${name}.test.ts`)],
    ['--test','test/package.test.mjs','test/pdf-preview.test.mjs','test/ai-environment-settings.test.mjs'],
    ['--test','--test-name-pattern=editor, preview and Diff|remote file recovery|file recovery acquires|restored remote files|an editor still loading|preview replacement|file tabs hide','test/plugin.test.mjs'],
]
for(const args of suites){
    const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit'})
    if(result.error)throw result.error
    if(result.status!==0)process.exit(result.status??1)
}
