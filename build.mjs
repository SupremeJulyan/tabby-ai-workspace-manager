import { build } from 'esbuild'
import { copyFile, mkdir, writeFile, cp, readFile, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
const result = await build({
    absWorkingDir: directory,
    entryPoints: ['.build/index.js'],
    outfile: 'dist/index.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: false,
    external: ['electron', '@angular/*', '@ng-bootstrap/*', 'rxjs', 'rxjs/*', 'tabby-*', 'russh'],
    metafile: true,
    legalComments: 'eof',
})
// PDF parsing is loaded only when opening a PDF; all worker/fonts/decoders stay offline.
await build({
    absWorkingDir:directory,entryPoints:['.build/arw-tree/preview/pdf-engine.js'],outfile:'dist/pdf-preview.cjs',
    bundle:true,platform:'node',format:'cjs',target:'node22',external:['@napi-rs/canvas'],legalComments:'eof',
    define:{'import.meta.url':'__ARW_PDF_MODULE_URL__'},
    banner:{js:'var __ARW_PDF_MODULE_URL__ = require("node:url").pathToFileURL(__filename).href;'},
})
await mkdir(new URL('dist/pdf-assets/',import.meta.url),{recursive:true})
await copyFile(new URL('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',import.meta.url),new URL('dist/pdf-assets/pdf.worker.min.mjs',import.meta.url))
for(const name of ['cmaps','standard_fonts','wasm','iccs'])await cp(new URL(`node_modules/pdfjs-dist/${name}/`,import.meta.url),new URL(`dist/pdf-assets/${name}/`,import.meta.url),{recursive:true})
await mkdir(new URL('dist/licenses/',import.meta.url),{recursive:true})
for(const name of ['marked','utif','pako','pdfjs-dist'])await copyFile(new URL(`node_modules/${name}/LICENSE`,import.meta.url),new URL(`dist/licenses/${name}.txt`,import.meta.url))
// A release must not require the workspace's private core package at runtime.
for (const output of Object.values(result.metafile.outputs)) {
    for (const entry of output.imports) {
        if (entry.external && (entry.path.startsWith('.') || entry.path.startsWith('@arw/'))) {
            throw new Error(`Unbundled workspace dependency: ${entry.path}`)
        }
    }
}
await mkdir(new URL('dist/', import.meta.url), { recursive: true })
await cp(new URL('.build/', import.meta.url), new URL('dist/', import.meta.url), {recursive:true,filter:source=>!source.endsWith('.js')})
await writeFile(new URL('dist/build-meta.json', import.meta.url), JSON.stringify(result.metafile, null, 2))
console.log('Built standalone tabby-ai-workspace-manager/dist/index.js')

const notices = 'Bundled ARW code is MIT licensed. Copyright (c) 2026 Julyan. See LICENSE.\n'
    + 'Tabby, Angular, RxJS and russh are host-provided and are not bundled.\n'
    + 'Preview libraries: Marked, UTIF.js and pako (MIT), PDF.js (Apache-2.0). Full licenses: dist/licenses/.\n'
    + 'PDF.js font/CMap/decoder asset notices are retained in dist/pdf-assets/.\n'
await writeFile(new URL('dist/THIRD_PARTY_LICENSES.txt', import.meta.url), notices)
await writeFile(new URL('THIRD_PARTY_NOTICES.md', import.meta.url), notices)
await build({
    absWorkingDir: directory,
    entryPoints: ['.build/arw-cli/cli.js'],
    outfile: 'dist/arw.cjs',
    define: { ARW_CLI_VERSION: JSON.stringify(JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8')).version) },
    platform: 'node', format: 'cjs', target: 'node18', bundle: true,
})

// Stable command shims point at the one installed CLI implementation.
await mkdir(new URL('dist/bin/',import.meta.url),{recursive:true})
await writeFile(new URL('dist/bin/arw',import.meta.url),'#!/usr/bin/env node\nrequire("../arw.cjs");\n')
await chmod(new URL('dist/bin/arw',import.meta.url),0o755)
await writeFile(new URL('dist/bin/arw.cmd',import.meta.url),'@node "%~dp0..\\arw.cjs" %*\r\n')

await build({entryPoints:['.build/arw-ai-cli/cli-lifecycle.js'],outfile:'dist/cli-lifecycle.cjs',bundle:true,platform:'node',format:'cjs',target:'node18'})
