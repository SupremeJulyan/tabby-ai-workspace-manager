/** Shared wire names and schemas keep CLI and HTTP validation in sync. */
export const commands: Record<string, { tool: string; positional?: string[]; fields: string[] }> = {
  workspaces: { tool: 'list_remote_workspaces', fields: [] },
  output: { tool: 'remote_output', positional: ['outputId', 'stream'], fields: ['outputId', 'stream', 'offset', 'length'] },
  upload: { tool: 'remote_upload', positional: ['localPath', 'remotePath'], fields: ['localPath', 'remotePath', 'recursive'] },
  download: { tool: 'remote_download', positional: ['remotePath', 'localPath'], fields: ['remotePath', 'localPath', 'recursive'] },
  'git-pull': { tool: 'remote_git_pull', positional: ['path'], fields: ['path'] },
  'git-push': { tool: 'remote_git_push', positional: ['path'], fields: ['path'] },
  list: { tool: 'remote_list', positional: ['path'], fields: ['path', 'limit', 'cursor'] },
  read: { tool: 'remote_read', positional: ['path'], fields: ['path', 'offset', 'length', 'head', 'tail', 'startLine', 'lineCount'] },
  'read-many': { tool: 'remote_read_many', fields: ['requests', 'maxBytes'] },
  search: { tool: 'remote_search', positional: ['query', 'path'], fields: ['query', 'path', 'mode', 'fixedStrings', 'ignoreCase', 'limit', 'include', 'excludeDirs'] },
  find: { tool: 'remote_search', positional: ['query', 'path'], fields: ['query', 'path', 'mode', 'limit', 'excludeDirs'] },
  write: { tool: 'remote_write', positional: ['path'], fields: ['path', 'content', 'allowEmpty', 'allowUnconditional'] },
  edit: { tool: 'remote_edit', positional: ['path'], fields: ['path', 'edits'] },
  create: { tool: 'remote_create', positional: ['path', 'type'], fields: ['path', 'type', 'content'] },
  delete: { tool: 'remote_delete', positional: ['path'], fields: ['path', 'recursive'] },
  chmod: { tool: 'remote_chmod', positional: ['path', 'mode'], fields: ['path', 'mode'] },
  move: { tool: 'remote_move', fields: ['sourcePath', 'targetPath', 'overwrite'] },
  exec: { tool: 'run_remote_command', positional: ['command'], fields: ['command'] },
  batch: { tool: 'arw_cli_batch', fields: ['operations'] },
};
export const help = `Usage: arw workspaces
       arw COMMAND [ARGUMENTS] [--id ID]

Workspace: workspaces
Read:      list, read, read-many, search, find, output
Write:     write, edit, create, delete, chmod, move
Transfer:  upload, download
Git:       git-pull, git-push
Execute:   exec, batch

Run arw COMMAND --help for arguments, limits and examples (no connection required).
AI terminals use .awm/workspace.json in their local working directory; otherwise use --id.
With user authorization for the target and operations, use explicit --id ID on each
command to access another workspace; --workspace aliases --id. This does not rebind
the terminal. Never substitute another target automatically if the bound one is unavailable.
Find IDs with arw workspaces. Remote paths start at workspaceRoot;
local transfer paths start at the CLI directory. Terminal mode supports exec/output.
Identity bindings may reconnect to a single matching session. If multiple sessions
match and neither the preferred nor original session is available, use --id.
Simple values use positional arguments/options; use --input JSON for structured input.
Long text can come from --file or stdin. Options: -h/--help,
-V/--version, --id ID, --compact (removes only status:"ok" and ok:true markers).
Text operations are limited to 5 MiB per file. Use download and upload for larger files.
Upload to a new path first; to replace an existing file, use move with overwrite:true.
Exec returns JSON by default and --raw prints streams.
write, edit, delete, and move save a snapshot in the remote account's private
~/.arw-snapshots directory before modifying files. Success includes snapshotId.
Snapshots require remote Git and GNU tar. A snapshot failure blocks the change.
--verbose remains an alias for JSON output.
Use --file for scripts with complex quoting or multiple lines; LF line endings are recommended.
`;

const commandHelp: Record<string, string> = {
  'workspaces': `Usage: arw workspaces

List IDs and identities of currently forwarded workspaces only. Does not accept --id.
Match host, port, user and workspaceRoot before operating. Ask the user to authorize
the target and intended operations unless already authorized, then pass explicit
--id ID on each command. Do not switch targets implicitly.`,
  'list': `Usage: arw list [PATH] [--limit N] [--cursor N] [--id ID]

PATH defaults to workspaceRoot.
  list defaults to 1000 entries (maximum 1000); pass returned nextCursor to --cursor.
Use --limit and --cursor for pagination; pass nextCursor as the --cursor value on the next request.
Structured fields are also accepted with --input JSON. --compact removes only status:"ok" and ok:true markers; it preserves result data and completeness fields.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'read': `Usage: arw read PATH [--offset N --length N | --head N | --tail N | --start-line N --line-count N] [--id ID]

  Byte reads (the default, or with --offset/--length) start at offset 0 and default
  to length 8192 bytes;
  each request returns at most 64 KiB and includes nextOffset, truncated, and complete.
  Continue byte reads with the returned nextOffset until complete is true.
  startLine is 1-based; lineCount defaults to 200. --head and --tail count lines.
  Line selection returns startLine, totalLines, truncated, and complete; continue with a later
  --start-line and --line-count. Byte offsets count UTF-8 bytes and are adjusted to
  valid character boundaries.
  fullFile indicates whether this response contains the entire file. Use --head 0
  to request the file hash without returning its text.
Structured input is also accepted with --input JSON.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'read-many': `Usage: arw read-many --input JSON [--id ID]

Each request uses read fields; see arw read --help.
  read-many accepts 1-50 requests and maxBytes (default 65536 total content bytes).
  If a read exceeds the remaining budget, it is marked skipped and processing stops.
  Check truncated/skipped before assuming completeness; read skipped files separately.
  fullFiles is true only when every result contains the entire file.
Example: arw read-many --input '{"requests":[{"path":"README.md","head":40}],"maxBytes":65536}'
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'search': `Usage: arw search QUERY [PATH] [--mode content|files|count|names] [--limit N] [--id ID]

  Default mode content uses JavaScript regular expressions, matched per line.
  files returns matching file paths; count counts matching lines per file.
  names/find match file basenames using * and ? globs, not directory paths:
    arw find '*.ts' src --id ID
  search defaults to 100 results (maximum 1000), excludes .git and node_modules,
  skips symlinks, and uses a 30-second deadline. Check timedOut for partial results.
  Binary/invalid UTF-8/oversize files are skipped. Inspect truncated and skippedFiles;
  results are not necessarily exhaustive. Narrow the path or use exec for further search.
  Additional search fields use --input JSON, for example:
    arw search 'a.b' src --id ID --input '{"fixedStrings":true,"ignoreCase":true,"include":"*.ts","excludeDirs":[],"limit":500}'
  include matches basenames; excludeDirs replaces the default directory-name exclusions.
Simple query and path values may be positional; use --input JSON for nested fields.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'find': `Usage: arw find GLOB [PATH] [--limit N] [--id ID]

Match file basenames using * and ? globs, not directory paths. PATH defaults to root.
Example: arw find '*.ts' src --id ID
Default limit 100 (maximum 1000); excludes .git and node_modules and skips symlinks.
Uses a 30-second deadline; inspect timedOut, truncated and complete. Override default
excluded directory names with --input JSON, for example:
  arw find '*.ts' src --input '{"excludeDirs":[".git","vendor"]}'
See arw search --help for content searching.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'write': `Usage: arw write PATH (--content FULL_TEXT | --file LOCAL_FILE | --file -) [--allow-empty] [--id ID]

FULL-FILE REPLACEMENT: existing file contents are completely replaced, not patched or appended.
Use arw edit for partial changes. Never send sample/placeholder text to test write on a project file.
--content is the literal ENTIRE new file content, not a filename, patch, or search/replacement.
--file reads a complete local UTF-8 file; --file - reads complete content from stdin.
Empty or whitespace-only content is rejected unless --allow-empty explicitly permits it.
A snapshot is saved before writing.
New snapshots store the original file independently of the project Git repository.
--allow-unconditional is still accepted for compatibility.
After writing, read back the target and check the intended contents.
--input JSON is also accepted for structured values.
--workspace aliases --id. --compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot.
Mutations stay inside workspaceRoot.
`,
  'edit': `Usage: arw edit PATH --input JSON [--id ID]

Use edit for partial changes; it preserves all text outside the specified replacements.
Each edit oldText must be nonempty and match exactly once; edits apply in array order.
Read first and use exact oldText from that file, then supply the intended newText.
newText is literal replacement text; an empty newText deletes the matched text.
JSON shape: {"path":"REMOTE_PATH","edits":[{"oldText":"EXACT_EXISTING_TEXT","newText":"INTENDED_REPLACEMENT"}]}
Replace all illustrative values with real values; never write placeholders into project files.
Do not use arw write for a partial edit: write replaces the entire file.
--input JSON contains edits; path may be positional or in JSON.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'create': `Usage: arw create PATH file|directory [--content TEXT | --file FILE | --file -] [--id ID]

Create a missing target; missing parent directories are not created.
Files default to empty content. Directories cannot have content.
Pass optional file content with --content, --file LOCAL_FILE, or --file - (stdin).
--input JSON is also accepted. Empty files are allowed; directories cannot have content.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'delete': `Usage: arw delete PATH [-r] [--id ID]

Delete a file or empty directory; -r / --recursive removes a directory recursively.
Cannot delete workspaceRoot. Do not automatically retry failed mutations.
--input JSON is also accepted.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'chmod': `Usage: arw chmod PATH MODE [--id ID]

MODE must be three octal digits, for example 755. Cannot chmod workspaceRoot.
--input JSON is also accepted.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'move': `Usage: arw move --input JSON [--id ID]

The target is an exact path, not a directory to move into. overwrite defaults to false.
Cannot move workspaceRoot; source and destination must remain inside it.
Example: arw move --input '{"sourcePath":"old","targetPath":"new","overwrite":false}'
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'exec': `Usage: arw exec [COMMAND | --command COMMAND | --file SCRIPT | --file -] [--id ID] [--raw]

Pass the complete shell command as one argument, with --command, through stdin, or from
a UTF-8 script file with --file SCRIPT (--file - reads stdin). Files preserve line endings;
LF is recommended for scripts shared across Windows, macOS, and Linux. The command is
sent unchanged and interpreted by the remote workspace's configured shell.
Shell quoting is local: use the syntax of the shell running arw. For multi-line commands,
prefer --file to avoid Bash/PowerShell/CMD quoting and escaping differences.
Exec uses its separate command policy; do not bypass policy denials.
Terminal mode uses the existing shell and first attempts to switch to the workspace root.
The terminal must be at a shell prompt. CRLF is normalized to LF and streams are combined.
Native Tabby streams capture output, including echo and prompts.
Capture returns after 1 second of quiet output; in terminal mode, completion and exit
status are unknown.
Changes to variables and directories persist, and exit closes the terminal shell.
  exec returns one JSON object with stdout/stderr and execution metadata; --raw prints
  the streams directly. For non-terminal execution, exitCode is returned and used as
  the CLI process status. Terminal mode returns exitCode:null and CLI status 1
  because command completion and success cannot be confirmed.
  When hasMore is true, use nextOffsets.stdout/stderr with the same workspace ID:
    arw output OUTPUT_ID stdout --offset N --id ID
  Continue each stream using returned nextOffset until truncated is false. Output offsets
  are UTF-8 bytes; default length is 65536. Stored output is bounded and can expire;
  do not rerun a mutation just to recover output.
  captureTruncated means some original output was lost before pagination.
  completionKnown reports whether the command's exit status was observed.
--raw prints streams; --compact preserves execution/completeness metadata.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'output': `Usage: arw output OUTPUT_ID stdout|stderr [--offset N --length N] [--id ID]

Read stored exec output using the same workspace ID. Offsets/length are UTF-8 bytes;
offset defaults to 0, length to 65536. Start at exec nextOffsets for each stream,
then continue with returned nextOffset until truncated is false.
Example: arw output OUTPUT_ID stdout --offset 32768 --id ID
Stored output is bounded and can expire; do not rerun a mutation to recover output.
Available in terminal mode too.
Options and fields may also be passed using --input JSON.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'upload': `Usage: arw upload [-r] LOCAL_PATH REMOTE_PATH [--id ID]

  JSON fields: localPath, remotePath, recursive. An existing destination directory receives source basename; the final target must
  not exist. Transfers do not overwrite, merge directories, or follow symbolic links.
    arw upload ./report.txt reports --id ID
      (if reports is a directory, creates reports/report.txt)
  On failure, completed files/directories may remain. Inspect before retrying.

Local relative paths start at the CLI current directory. Use -r for directories.
--input JSON is available for structured fields.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'download': `Usage: arw download [-r] REMOTE_PATH LOCAL_PATH [--id ID]

  JSON fields: remotePath, localPath, recursive. An existing destination directory receives source basename; the final target must
  not exist. Transfers do not overwrite, merge directories, or follow symbolic links.
    arw download -r assets ./backup --id ID
      (if ./backup is a directory, creates ./backup/assets)
  On failure, completed files/directories may remain. Inspect before retrying.

Local relative paths start at the CLI current directory. Use -r for directories.
--input JSON is available for structured fields.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'git-pull': `Usage: arw git-pull [REMOTE_PATH] [--id ID]

Relay Git through local network/credentials. PATH defaults to workspaceRoot.
Use the current branch upstream; pull allows fast-forward only.
--input JSON is also accepted.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'git-push': `Usage: arw git-push [REMOTE_PATH] [--id ID]

Relay Git through local network/credentials. PATH defaults to workspaceRoot.
Use the current branch upstream; push never forces updates.
--input JSON is also accepted.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
  'batch': `Usage: arw batch --input JSON [--id ID]

Batch accepts 1-50 operations on the same workspace; workspaces, batch, transfers,
and git-pull/git-push cannot be nested. It runs in order and stops at the first failure;
completed changes are not rolled back. failedIndex is zero-based (null on success),
and notRun counts unattempted operations. Inspect each results entry; completed includes
an attempted failing operation. Do not automatically retry failed mutations.
Example: arw batch --input '{"operations":[{"command":"read","arguments":{"path":"README.md"}}]}'
Arguments use the command JSON fields; see arw COMMAND --help.
Batch operations use a JSON object with an operations array.
--compact removes only status markers (status: "ok" and ok: true); all result and completeness fields remain.
Remote relative paths start at workspaceRoot. Mutations stay inside workspaceRoot;
read-only paths may access outside it subject to account permissions.
`,
};

export function helpForCommand(command: string): string {
  if (!Object.hasOwn(commands, command) || !Object.hasOwn(commandHelp, command)) {
    throw new Error('Unsupported command; use --help');
  }
  return command==='workspaces'?commandHelp[command]:commandHelp[command]+'\nDefaults to the current directory\'s .awm/workspace.json binding. No parent-directory or environment fallback. --id optionally overrides the target.\n';
}
