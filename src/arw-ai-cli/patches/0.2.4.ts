import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { ensurePlaceholderGuidance, removeGeneratedAgentGuidance } from '../../arw-cli/instructions'

export function migratePlaceholderGuidance(storageRoot: string, current: string, remoteRoot: string): void {
    const root = join(storageRoot, 'agent-cwd')
    function migrate(directory: string): void {
        if (directory === current) return
        const file = join(directory, 'AGENTS.md')
        try {
            if (!lstatSync(file).isFile()) return
            const content = readFileSync(file, 'utf8')
            const match = /^Remote project root: ("(?:[^"\\]|\\.)*")\./m.exec(content)
            if (match) {
                let path: string
                try { path = JSON.parse(match[1]) } catch { return }
                if (posix.isAbsolute(path)) ensurePlaceholderGuidance(directory, path)
            } else {
                // Old templates without a root can be recreated when the workspace opens.
                removeGeneratedAgentGuidance(directory)
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const directory = join(root, entry.name)
        if (/^[^@]+@\d+@/.test(entry.name)) migrate(directory)
        else if (/^[a-f0-9]+-[a-f0-9]+$/.test(entry.name)) {
            for (const child of readdirSync(directory, { withFileTypes: true })) {
                if (child.isDirectory() && /^[a-f0-9]{16}(?:-terminal(?:-[a-f0-9]{16})?)?$/.test(child.name)) {
                    migrate(join(directory, child.name))
                }
            }
        }
    }
    ensurePlaceholderGuidance(current, remoteRoot)
}
