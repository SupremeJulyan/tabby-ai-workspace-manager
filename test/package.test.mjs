import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, readdir, cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(args, cwd) {
    const result = spawnSync(npm, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout
}
test('release archive installs without Tabby source or a separate ARW core', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'arw-plugin-install-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const plugin = fileURLToPath(new URL('..', import.meta.url))
    const snapshot = join(directory, 'snapshot')
    await mkdir(snapshot)
    for (const name of ['dist', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/cli-lifecycle.mjs']) {
        await mkdir(join(snapshot, 'scripts'), {recursive:true})
        await cp(join(plugin, name), join(snapshot, name), { recursive: true })
    }
    const packed = JSON.parse(run(['pack', snapshot, '--pack-destination', directory, '--json'], directory))
    const [archive] = Array.isArray(packed) ? packed : Object.values(packed)
    assert.ok(archive.files.some(file => file.path === 'dist/index.js'))
    assert.ok(archive.files.some(file => file.path === 'dist/arw.cjs'))
    for(const path of ['dist/pdf-preview.cjs','dist/pdf-assets/pdf.worker.min.mjs','dist/licenses/pdfjs-dist.txt','dist/licenses/marked.txt','dist/licenses/utif.txt','dist/licenses/pako.txt'])assert.ok(archive.files.some(file=>file.path===path),`Missing preview asset: ${path}`)
    for(const folder of ['cmaps','standard_fonts','wasm','iccs'])assert.ok(archive.files.some(file=>file.path.startsWith(`dist/pdf-assets/${folder}/`)))
    assert.ok(archive.files.some(file => file.path === 'dist/THIRD_PARTY_LICENSES.txt'))
    assert.ok(!archive.files.some(file => /^(src|node_modules|\.build)\//.test(file.path)))
    run(['install', '--prefix', directory, '--ignore-scripts', '--omit=dev', '--legacy-peer-deps',
        '--no-audit', '--no-fund', join(directory, archive.filename)], directory)
    const installed = join(directory, 'node_modules', 'tabby-ai-workspace-manager')
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    assert.ok(manifest.name.startsWith('tabby-'), 'Tabby only discovers installed plugin directories with its plugin prefix')
    assert.ok(manifest.keywords.includes('tabby-plugin'))
    assert.deepEqual(manifest.bin, {arw:'dist/arw.cjs'})
    const help = spawnSync(process.execPath, [join(installed,'dist/arw.cjs'),'--help'],{encoding:'utf8'})
    assert.equal(help.status,0,help.stderr)
    assert.match(help.stdout,/Usage: arw workspaces/)
    assert.doesNotMatch(help.stdout, /--config|--skills|cp \[-r\]/)
    assert.match(help.stdout, /upload, download/)
    assert.match(help.stdout, /COMMAND --help/)
    assert.match(help.stdout, /git-pull/)
    assert.match(help.stdout, /git-push/)
    const removed = spawnSync(process.execPath, [join(installed,'dist/arw.cjs'),'install'],{cwd:directory,encoding:'utf8'})
    assert.notEqual(removed.status,0)
    assert.equal(manifest.dependencies, undefined)
    assert.ok(!(await readdir(join(directory, 'node_modules'))).includes('@arw'))
    const meta = JSON.parse(await readFile(join(installed, 'dist/build-meta.json'), 'utf8'))
    const imports = Object.values(meta.outputs).flatMap(output => output.imports).filter(entry => entry.external)
    assert.ok(imports.some(entry => entry.path === 'tabby-ssh'))
    assert.ok(!imports.some(entry => entry.path.startsWith('.') || entry.path.startsWith('@arw/')))
})
