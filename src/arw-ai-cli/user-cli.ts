import { t } from '../shared/i18n'
import { chmod, lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ensureWindowsCli } from './windows-cli'

export async function ensureUserCli (source: string, home = homedir(),platform:NodeJS.Platform=process.platform): Promise<void> {
    if (platform === 'win32') return ensureWindowsCli(source,home)
    const directory = join(home, '.local', 'bin')
    const command = join(directory, 'arw')
    await mkdir(directory, { recursive: true })
    await chmod(source, 0o755)
    try { await symlink(source, command) }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing=await readlink(command).catch(()=>'')
        if(existing===source)return
        // Previous plugin installs used a symlink directly to dist/arw.cjs.
        // Replace only that recognizable plugin link; preserve foreign files and links.
        const ownedLink=existing!==''&&basename(dirname(existing))==='dist'&&basename(existing)==='arw.cjs'
            &&basename(dirname(dirname(existing)))==='tabby-ai-workspace-manager'
        const info=await lstat(command).catch(()=>undefined)
        if(!ownedLink||!info?.isSymbolicLink())throw new Error(t`已有其他 arw 命令，未覆盖：${command}`)
        await rm(command)
        await symlink(source,command)
    }
}
