import { t } from '../shared/i18n'
import { chmod, mkdir, readlink, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
        if (await readlink(command).catch(() => '') !== source) {
            throw new Error(t`已有其他 arw 命令，未覆盖：${command}`)
        }
    }
}
