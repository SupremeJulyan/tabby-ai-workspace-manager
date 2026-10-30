/** Shared wire names and schemas keep CLI and HTTP validation in sync. */
export const commands: Record<string, { tool: string; positional?: string[]; fields: string[] }> = {
  workspaces: { tool: 'list_remote_workspaces', fields: [] },
  'current-file': { tool: 'current_remote_file', fields: [] },
  output: { tool: 'remote_output', positional: ['outputId', 'stream'], fields: ['outputId', 'stream', 'offset', 'length'] },
  upload: { tool: 'remote_upload', positional: ['source', 'target'], fields: ['source', 'target', 'recursive'] },
  download: { tool: 'remote_download', positional: ['source', 'target'], fields: ['source', 'target', 'recursive'] },
  'git-pull': { tool: 'remote_git_pull', positional: ['path'], fields: ['path'] },
  'git-push': { tool: 'remote_git_push', positional: ['path'], fields: ['path'] },
  list: { tool: 'remote_list', positional: ['path'], fields: ['path', 'limit', 'cursor'] },
  read: { tool: 'remote_read', positional: ['path'], fields: ['path', 'offset', 'length', 'head', 'tail', 'startLine', 'lineCount'] },
  'read-many': { tool: 'remote_read_many', fields: ['requests', 'maxBytes'] },
  search: { tool: 'remote_search', positional: ['query', 'path'], fields: ['query', 'path', 'mode', 'fixedStrings', 'ignoreCase', 'limit', 'include', 'excludeDirs'] },
  find: { tool: 'remote_search', positional: ['query', 'path'], fields: ['query', 'path', 'mode', 'limit', 'excludeDirs'] },
  write: { tool: 'remote_write', positional: ['path'], fields: ['path', 'content', 'expectedHash'] },
  edit: { tool: 'remote_edit', positional: ['path'], fields: ['path', 'edits', 'expectedHash'] },
  create: { tool: 'remote_create', positional: ['path', 'type'], fields: ['path', 'type', 'content'] },
  delete: { tool: 'remote_delete', positional: ['path'], fields: ['path', 'recursive'] },
  chmod: { tool: 'remote_chmod', positional: ['path', 'mode'], fields: ['path', 'mode'] },
  move: { tool: 'remote_move', fields: ['sourcePath', 'targetPath', 'overwrite'] },
  exec: { tool: 'run_remote_command', positional: ['command'], fields: ['command'] },
  batch: { tool: 'arw_cli_batch', fields: ['operations'] },
};
export const help = `Usage: arw workspaces
       arw COMMAND [--id ID] [arguments]

Workspace: workspaces, current-file
Read:      list, read, read-many, search, find, output
Write:     write, edit, create, delete, chmod, move
Transfer:  upload, download
Git:       git-pull, git-push
Execute:   exec, batch

Run arw COMMAND --help for arguments, limits and examples (no connection required).
AI terminals use .awm/workspace.json in their local working directory; otherwise use --id.
Use --id to target another workspace; --workspace aliases --id.
Find IDs with arw workspaces. Remote paths start at workspaceRoot;
local transfer paths start at the CLI directory. Terminal mode supports exec/output.
Options: -h/--help, -V/--version, --compact; exec --verbose returns JSON.
`;

const commandHelp: Record<string, string> = {
  'workspaces': `Usage: arw workspaces

List IDs and identities of currently forwarded workspaces only. Does not accept --id.
Match the target before operating; do not switch targets implicitly.`,
  'current-file': `Usage: arw current-file --id ID

Return the currently open file, or null.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'list': `Usage: arw list [PATH] --id ID [--limit N] [--cursor N]

PATH defaults to workspaceRoot.
  list defaults to 1000 entries (maximum 1000); pass returned nextCursor as --cursor.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'read': `Usage: arw read PATH --id ID [--offset N --length N | --head N | --tail N | --start-line N --line-count N]

  read without selection returns the whole UTF-8 text file (up to 500 MiB).
  --offset and --length use UTF-8 bytes, starting at offset 0; default length is 65536.
  --start-line is 1-based; default --line-count is 200. --head/--tail count lines.
Byte reads return nextOffset; continue until truncated is false.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'read-many': `Usage: arw read-many --id ID --input JSON|-

Each request uses read fields; see arw read --help.
  read-many accepts 1-50 requests and maxBytes (default 65536 total content bytes).
  If a read exceeds the remaining budget, it is marked skipped and processing stops.
  Check truncated/skipped before assuming completeness; read skipped files separately.
Example: arw read-many --id ID --input '{"requests":[{"path":"README.md","head":40}],"maxBytes":65536}'
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'search': `Usage: arw search QUERY [PATH] --id ID [--mode content|files|count|names] [--limit N]

  Default mode content uses JavaScript regular expressions, matched per line.
  files returns matching file paths; count counts matching lines per file.
  names/find match file basenames using * and ? globs, not directory paths:
    arw find '*.ts' src --id ID
  search defaults to 100 results (maximum 1000), excludes .git and node_modules,
  skips symlinks, and stops after 10000 visited entries or 8 MiB of scanned text.
  Binary/invalid UTF-8/oversize files are skipped. Inspect truncated and skippedFiles;
  results are not necessarily exhaustive. Narrow the path or use exec for further search.
  Additional search fields use --input JSON (camelCase), for example:
    arw search 'a.b' src --id ID --input '{"fixedStrings":true,"ignoreCase":true,"include":"*.ts","excludeDirs":[],"limit":500}'
  include matches basenames; excludeDirs replaces the default directory-name exclusions.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'find': `Usage: arw find GLOB [PATH] --id ID [--limit N]

Match file basenames using * and ? globs, not directory paths. PATH defaults to root.
Example: arw find '*.ts' src --id ID
Default limit 100 (maximum 1000); excludes .git and node_modules and skips symlinks.
Stops after 10000 visited entries; inspect truncated. Override exclusions with
--input '{"excludeDirs":[]}'. See arw search --help for content searching.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'write': `Usage: arw write PATH --id ID (--content TEXT | --file FILE | --file -)

  write writes the complete supplied content, replacing existing content.
--file reads local UTF-8 text; local relative paths start at the CLI directory.
--file - reads stdin. Read first and pass its hash to prevent stale writes:
  arw write file.txt --file ./replacement.txt --id ID --input '{"expectedHash":"HASH"}'
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'edit': `Usage: arw edit PATH --id ID --input JSON|-

  Each edit oldText must be nonempty and match exactly once; edits apply in array order.
  Read first and pass the returned hash as expectedHash to guard against stale writes:
    arw write file.txt --file ./replacement.txt --id ID --input '{"expectedHash":"HASH"}'
    arw edit file.txt --id ID --input '{"expectedHash":"HASH","edits":[{"oldText":"old","newText":"new"}]}'
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'create': `Usage: arw create PATH file|directory --id ID [--content TEXT | --file FILE | --file -]

Create a missing target; missing parent directories are not created.
Files default to empty content. Directories cannot have content.
--file reads local UTF-8 text relative to the CLI directory; --file - reads stdin.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'delete': `Usage: arw delete PATH --id ID [-r]

Delete a file or empty directory; -r / --recursive removes a directory recursively.
Cannot delete workspaceRoot. Do not automatically retry failed mutations.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'chmod': `Usage: arw chmod PATH MODE --id ID

MODE must be three octal digits, for example 755. Cannot chmod workspaceRoot.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'move': `Usage: arw move --id ID --input JSON|-

Example: arw move --id ID --input '{"sourcePath":"old","targetPath":"new","overwrite":false}'
The target is an exact path, not a directory to move into. overwrite defaults to false.
Cannot move workspaceRoot; source and destination must remain inside it.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'exec': `Usage: arw exec --id ID [--verbose] -- 'COMMAND'

Quote COMMAND as one argument; place all CLI options before --.
Exec uses its separate command policy; do not bypass policy denials.
Terminal mode injects into the existing shell and inherits its directory, user and
exported environment; the terminal must be at a shell prompt. Streams are combined.
  exec normally prints raw streams and returns the remote exit code; --verbose uses JSON.
  For truncated exec output, use nextOffsets.stdout/stderr with the same workspace ID:
    arw output OUTPUT_ID stdout --offset N --id ID
  Continue each stream using returned nextOffset until truncated is false. Output offsets
  are UTF-8 bytes; default length is 65536. Stored output is bounded and can expire;
  do not rerun a mutation just to recover output.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'output': `Usage: arw output OUTPUT_ID stdout|stderr --id ID [--offset N --length N]

Read stored exec output using the same workspace ID. Offsets/length are UTF-8 bytes;
offset defaults to 0, length to 65536. Start at exec nextOffsets for each stream,
then continue with returned nextOffset until truncated is false.
Example: arw output OUTPUT_ID stdout --offset 32768 --id ID
Stored output is bounded and can expire; do not rerun a mutation to recover output.
Available in terminal mode too.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'upload': `Usage: arw upload [-r] LOCAL_PATH REMOTE_PATH --id ID

  An existing destination directory receives source basename; the final target must
  not exist. Transfers do not overwrite, merge directories, or follow symbolic links.
    arw upload ./report.txt reports --id ID
      (if reports is a directory, creates reports/report.txt)
    arw download -r assets ./backup --id ID
      (if ./backup is a directory, creates ./backup/assets)
  On failure, completed files/directories may remain. Inspect before retrying.

Local relative paths start at the CLI current directory. Use -r for directories.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'download': `Usage: arw download [-r] REMOTE_PATH LOCAL_PATH --id ID

  An existing destination directory receives source basename; the final target must
  not exist. Transfers do not overwrite, merge directories, or follow symbolic links.
    arw upload ./report.txt reports --id ID
      (if reports is a directory, creates reports/report.txt)
    arw download -r assets ./backup --id ID
      (if ./backup is a directory, creates ./backup/assets)
  On failure, completed files/directories may remain. Inspect before retrying.

Local relative paths start at the CLI current directory. Use -r for directories.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'git-pull': `Usage: arw git-pull [REMOTE_PATH] --id ID

Relay Git through local network/credentials. PATH defaults to workspaceRoot.
Use the current branch upstream; pull allows fast-forward only.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'git-push': `Usage: arw git-push [REMOTE_PATH] --id ID

Relay Git through local network/credentials. PATH defaults to workspaceRoot.
Use the current branch upstream; push never forces updates.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'batch': `Usage: arw batch --id ID --input JSON|-

Batch accepts 1-50 operations on the same workspace; workspaces, batch, transfers,
and git-pull/git-push cannot be nested. It runs in order and stops at the first failure;
completed changes are not rolled back. Inspect each results entry; completed includes
an attempted failing operation. Do not automatically retry failed mutations.
Example: arw batch --id ID --input '{"operations":[{"command":"read","arguments":{"path":"README.md"}}]}'
Arguments use the command JSON fields; see arw COMMAND --help.
--workspace aliases --id. --input JSON|- supplies structured fields (camelCase);
--input - reads stdin. --compact omits successful/empty status metadata.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
};

export function helpForCommand(command: string): string {
  if (!Object.hasOwn(commands, command) || !Object.hasOwn(commandHelp, command)) {
    throw new Error('Unsupported command; use --help');
  }
  return command==='workspaces'?commandHelp[command]:commandHelp[command].replaceAll('--id ID','[--id ID]')+'\nDefaults to the current directory\'s .awm/workspace.json binding. No parent-directory or environment fallback. --id optionally overrides the target.\n';
}
