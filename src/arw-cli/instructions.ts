import { lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// Historical templates are retained only to identify plugin-owned files for cleanup.
const boundCliGuidance = `# ARW remote workspace

This local directory is a placeholder, not a project copy or mount. Read .awm/workspace.json locally for metadata; use arw for all remote project files, Git, builds, tests and commands. Do not create or edit project files in the placeholder.

This AI terminal is bound to its workspace. Run arw commands directly without --id; the binding remains fixed when the sidebar switches workspaces. If disconnected or unavailable, reconnect it in Tabby or reopen this AI terminal; never choose another target automatically. Only use arw workspaces and an explicit --id ID when intentionally operating on another workspace.

Before working, discover and read applicable remote project instructions, including AGENTS.md at the project root and along the directories containing files you will change. They are not automatically loaded here.

Run arw --help for the command index and arw COMMAND --help for syntax, path rules, limits and examples. Inspect incomplete results before drawing conclusions. Use arw output to continue stored command output instead of rerunning the command.

Keep mutations inside workspaceRoot. Do not bypass POLICY_DENIED or expose connection URLs, tokens or credentials.
`;

/** Upgrade only byte-for-byte plugin-generated instructions; preserve user edits. */
export function legacyCliGuidance(terminalOnly:boolean):string {
    const current=terminalOnly?boundTerminalCliGuidance:boundCliGuidance
    return current.replace(/^This AI terminal is bound[^\n]+/m,terminalOnly
        ?'Run arw workspaces and verify the exact workspaceId from the metadata is forwarded. Use --id ID for each operation. If unavailable, reopen the AI terminal in terminal mode; never substitute another workspace with the same path.'
        :'Run arw workspaces and match host, port, user and workspaceRoot against the metadata (remoteRoot). Use --id ID for every operation on that forwarded workspace. Ask the user if ambiguous; if unavailable, have it reconnected in Tabby. Never switch targets implicitly.')
}

const boundTerminalCliGuidance = `# ARW terminal mode

This local directory is a placeholder, not a project copy or mount. Read .awm/workspace.json locally for metadata; do not create or edit project files here.

This AI terminal is bound to the exact terminal-mode session. Run arw commands without --id. If unavailable, reopen the AI terminal in terminal mode; never substitute another workspace or terminal with the same path. An explicit --id ID is only for intentionally targeting another workspace.

Use arw exec for all project operations in the existing terminal, and arw output for stored output. Keep operations inside remoteRoot from the metadata. The terminal must be at a shell prompt; if its directory changes, resynchronize it in Tabby and reopen the AI terminal.

Before working, discover and read applicable remote project instructions, including AGENTS.md at the project root and along the directories containing files you will change. They are not automatically loaded here.

Run arw --help for the command index and arw COMMAND --help for syntax, terminal behavior, limits and examples. Inspect incomplete results and continue stored output instead of rerunning commands. Do not bypass POLICY_DENIED or expose connection URLs, tokens or credentials.
`;

export const cliGuidance = `# ARW remote workspace

Use the arw-cli skill for remote operations. This local directory is a placeholder, not a project copy or mount; do not write project files here. Identity metadata is available in .awm/workspace.json when needed.

This AI terminal is already bound: run arw without --id. Sidebar switches do not change the target. If unavailable, reconnect or reopen it; never choose another workspace automatically. Use arw workspaces and --id ID only for intentional cross-workspace operations or older unbound terminals.

Read applicable remote project instructions, including AGENTS.md, before changes. Use known commands directly; consult arw COMMAND --help only for unfamiliar syntax or usage errors. Do not bypass POLICY_DENIED.
`;

export const terminalCliGuidance = `# ARW terminal mode

Use the arw-cli skill. This local directory is a placeholder, not project files. Use arw exec for all project operations in the existing terminal, and arw output for stored output. The terminal must be at a shell prompt.

Omit --id for this bound terminal. If unavailable, reopen the AI terminal in terminal mode; never substitute another session. Read applicable remote project instructions before changes. Use known commands directly; consult arw COMMAND --help only for unfamiliar syntax or usage errors. Do not bypass POLICY_DENIED.
`;

export function isGeneratedCliGuidance(content:string):boolean {
    if([cliGuidance,terminalCliGuidance,boundCliGuidance,boundTerminalCliGuidance,legacyCliGuidance(false),legacyCliGuidance(true)].includes(content))return true
    // Exact original templates from f2b267b^, including their trailing newline.
    return ['2f54fe7663982bb6db613e1ff56dafba4f910613a07d52a411dcd45576c28795',
        '0b82b1f8025aa064934fc27dc24092da8eb5c68bdf66e7af0670f11d54112bf1']
        .includes(createHash('sha256').update(content).digest('hex'))
}

/** Remove only exact generated templates, never user edits, links or project instructions. */
export function removeGeneratedAgentGuidance(placeholder:string):boolean {
    const file=join(placeholder,'AGENTS.md')
    try{
        if(!lstatSync(file).isFile()||!isGeneratedCliGuidance(readFileSync(file,'utf8')))return false
        unlinkSync(file)
        return true
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}
}

/** Historical generated notes are retained only for exact-match migration. */
function previousPlaceholderGuidance(remoteRoot:string):string {
    return `# ARW workspace\n\nThis local directory is only an AI startup placeholder, not a project copy or mount.\nRemote project root: ${JSON.stringify(remoteRoot)}. The workspace identity and binding are in the ARW_WORKSPACE_* environment variables.\nUse arw for remote project files and commands; see the arw-cli skill for usage. Read the remote project's applicable instructions before changes.\n`
}

function skillPlaceholderGuidance(remoteRoot:string):string {
    return `# ARW workspace\n\nThis local directory is only an AI startup placeholder, not a project copy or mount.\nRemote project root: ${JSON.stringify(remoteRoot)}. The workspace binding is in .awm/workspace.json.\nUse this directory as the local working directory when running arw; remote paths are command arguments. arw does not use inherited ARW_WORKSPACE_* variables or search parent directories for a binding.\nUse arw for remote project files and commands; see the arw-cli skill for usage. Read the remote project's applicable instructions before changes.\n`
}

export function placeholderGuidance(remoteRoot:string):string {
    return [
        '# ARW workspace','',
        'This local directory is only an AI startup placeholder, not a project copy or mount.',
        `Remote project root: ${JSON.stringify(remoteRoot)}.`,
        'arw reads .awm/workspace.json in its local working directory. Run arw with this placeholder as the local workdir; pass remote paths as arguments. Parent directories and inherited ARW_WORKSPACE_* variables are not used for binding.',
        'Omit --id for this bound workspace. If unavailable, reconnect it in Tabby; never switch targets automatically. In an unbound terminal, ask the user to identify the target, list forwarded choices with arw workspaces, and use --id ID. An explicit --id also overrides the binding.','',
        'Common commands:',
        '```sh',
        'arw list src',
        'arw read AGENTS.md',
        'arw read src/main.ts --head 80',
        'arw search TODO src',
        "arw find '*.ts' src",
        "arw exec -- 'git status --short'",
        "arw exec -- 'npm test'",
        "arw write notes.txt --content 'text'",
        'arw write notes.txt --file ./local-text.txt',
        'arw upload ./local-file.txt remote-file.txt',
        'arw download -r remote-folder ./local-folder',
        'arw git-pull',
        'arw git-push --path subproject',
        '```','',
        'Remote relative paths start at the workspace root; local transfer paths start at the local workdir. Read applicable remote project instructions before changes. Keep mutations inside the remote root.',
        'Use known commands directly. Only consult arw COMMAND --help for unfamiliar syntax or usage errors; do not routinely query the help index or enumerate workspaces first.',
        'Reads/searches return JSON; exec prints output and propagates exit status. Honor truncation and continuation fields. Continue stored output with arw output OUTPUT_ID stdout --offset OFFSET instead of rerunning a mutation. Inspect state before retrying interrupted mutations. Do not bypass POLICY_DENIED.',
        'Terminal-mode bindings support only arw exec and arw output, running in the existing terminal at a shell prompt.','',
    ].join('\n')
}

export function ensurePlaceholderGuidance(placeholder:string,remoteRoot:string):void {
    removeGeneratedAgentGuidance(placeholder)
    try{writeFileSync(join(placeholder,'AGENTS.md'),placeholderGuidance(remoteRoot),{mode:0o600,flag:'wx'})}
    catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
        const file=join(placeholder,'AGENTS.md')
        if(lstatSync(file).isFile()){
            const content=readFileSync(file,'utf8')
            if([previousPlaceholderGuidance(remoteRoot),skillPlaceholderGuidance(remoteRoot)].includes(content))writeFileSync(file,placeholderGuidance(remoteRoot),{mode:0o600})
        }
    }
}
