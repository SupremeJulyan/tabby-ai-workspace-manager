import { rm } from 'node:fs/promises'
for (const name of ['.build/', 'dist/']) await rm(new URL(name, import.meta.url), { recursive: true, force: true })
