import { t } from '../shared/i18n'
import { chmod, mkdir, readlink, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function ensureUserCli (source: string, home = homedir()): Promise<void> {
    if (process.platform === 'win32') return
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
