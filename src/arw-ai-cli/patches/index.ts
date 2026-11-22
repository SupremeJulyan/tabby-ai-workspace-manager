import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migratePlaceholderGuidance } from './0.2.4'

const patches = [{ version: '0.2.4', apply: migratePlaceholderGuidance }]

export function applyPlaceholderPatches(storageRoot: string, placeholder: string, remoteRoot: string): void {
    const marker = join(storageRoot, 'version')
    let stored = '0.0.0'
    try {
        if (!lstatSync(marker).isFile()) throw new Error('Invalid ARW version file')
        stored = readFileSync(marker, 'utf8').trim()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const previous = /^\d+\.\d+\.\d+$/.test(stored) ? stored.split('.').map(Number) : [0, 0, 0]
    for (const patch of patches) {
        const next = patch.version.split('.').map(Number)
        const difference = next.findIndex((value, index) => value !== previous[index])
        if (difference < 0 || next[difference] < previous[difference]) continue
        patch.apply(storageRoot, placeholder, remoteRoot)
        writeFileSync(marker, patch.version + '\n', { mode: 0o600 })
    }
}
