import { mkdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['pack', '.', '--pack-destination', './artifacts', '--json'], {
    cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
})
if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status ?? 1) }
const packed = JSON.parse(result.stdout)
const [archive] = Array.isArray(packed) ? packed : Object.values(packed)
if (!archive.files.some(file => file.path === 'dist/index.js')) throw new Error('Missing plugin entry point')
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
if (manifest.dependencies && Object.keys(manifest.dependencies).length) throw new Error('Unexpected runtime dependencies')
console.log(`Created artifacts/${archive.filename}`)
console.log('Install from Tabby’s plugins directory:')
console.log(`npm install --omit=dev --legacy-peer-deps ${JSON.stringify(`${root}artifacts/${archive.filename}`)}`)
