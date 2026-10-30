import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { access, cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const source = fileURLToPath(new URL('../', import.meta.url))
await access(join(source, 'dist/index.js')).catch(() => {
    throw new Error('Build the plugin first: npm run build')
})
// Source-workspace devDependencies can shadow the host's SSH classes.
// Stage only release files so runtime resolution always reaches the real host.
const staging = await mkdtemp(join(tmpdir(), 'tabby-ai-workspace-manager-dev-'))
// Tabby only discovers plugin directories whose names start with `tabby-`.
const destination = join(staging, 'tabby-ai-workspace-manager')
await mkdir(destination)
for (const name of ['dist', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await cp(join(source, name), join(destination, name), { recursive: true })
}
// Keep profiles/settings, but isolate userData so an installed tabby-safs or
// another ARW copy cannot load beside the working tree.
const userData = join(staging, 'user-data')
await mkdir(userData)
const config = process.env.TABBY_CONFIG_DIRECTORY ?? (
    process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'tabby')
        : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'tabby')
            : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tabby'))
const executable = process.argv[2] ?? 'tabby'
const child = spawn(executable, [`--user-data-dir=${userData}`, '--debug', ...process.argv.slice(3)], {
    env: { ...process.env, TABBY_CONFIG_DIRECTORY: config, TABBY_PLUGINS: staging }, stdio: 'inherit',
})
const cleanup = () => rm(staging, { recursive: true, force: true })
child.on('error', async error => {
    console.error(`Unable to start Tabby: ${error.message}`)
    await cleanup()
    process.exitCode = 1
})
child.on('exit', async code => { await cleanup(); process.exitCode = code ?? 1 })
