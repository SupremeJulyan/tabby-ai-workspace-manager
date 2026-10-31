import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { buildSync } from 'esbuild'

// The installed release has shell support that is not yet in this working tree.
// Patch only its default resolution, preserving the rest of that release.
export function patchDefaultShell(source) {
    if (source.includes('/* ARW default shell fallback */')) return source
    const start = source.indexOf('          const selected = configured?.shell;')
    const end = source.indexOf('          const current = available.find', start)
    const settings = 'this.shellId = this.shells.find((shell) => shell.id === preferred)?.id ?? "";'
    if (start < 0 || end < start || !source.includes(settings)) {
        throw new Error('Unrecognized plugin build; refusing to change it')
    }
    const compiled = buildSync({
        entryPoints: [fileURLToPath(new URL('../src/arw-ai-cli/default-shell.ts', import.meta.url))],
        bundle: true, write: false, format: 'iife', globalName: 'ArwDefaultShell', platform: 'node',
    }).outputFiles[0].text
    const fallback = `(function () { ${compiled}\nreturn ArwDefaultShell.defaultShell; })()`
    const replacement = `          /* ARW default shell fallback */
          const profiles = await this.profiles.getProfiles({ includeBuiltin: true });
          const available = (0, shell_selection_1.selectableShells)(profiles);
          const selected = configured?.shell ?? (${fallback})(available, this.config.store.terminal?.profile);
`
    return (source.slice(0, start) + replacement + source.slice(end))
        .replace(settings, `this.shellId = (${fallback})(this.shells, preferred)?.id ?? "";`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const target = process.argv[2]
    if (!target) throw new Error('Usage: node scripts/fix-default-shell.mjs /path/to/plugin/dist/index.js')
    const original = await readFile(target, 'utf8')
    const patched = patchDefaultShell(original)
    if (patched !== original) {
        const backup = `${target}.before-default-shell-${Date.now()}`
        await copyFile(target, backup)
        await writeFile(target, patched)
        console.log(`Fixed default shell resolution. Backup: ${backup}`)
    } else console.log('Default shell fix already applied')
}
