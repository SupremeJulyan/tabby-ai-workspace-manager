import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
const {installUserCli,uninstallUserCli}=require('../dist/cli-lifecycle.cjs')
const source=fileURLToPath(new URL('../dist/arw.cjs',import.meta.url))
await (process.argv[2]==='uninstall'?uninstallUserCli:installUserCli)(source)
