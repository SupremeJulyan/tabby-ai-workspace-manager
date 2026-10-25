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
export const help = `Usage: arw COMMAND [arguments] --id ID
Workspace: workspaces [--saved]; current-file
Read:      list [PATH] [--limit N] [--cursor N]
           read PATH [--offset N --length N | --head N | --tail N | --start-line N --line-count N]
           read-many --input '{"requests":[{"path":"README.md","head":40}]}'
           search QUERY [PATH] [--mode content|files|count|names]
           find GLOB [PATH]
           output OUTPUT_ID stdout|stderr [--offset N --length N]
Write:     write PATH --content TEXT|--file FILE|-
           edit PATH --input '{"edits":[{"oldText":"old","newText":"new"}]}'
           create PATH file|directory [--content TEXT|--file FILE|-]
           delete PATH [--input '{"recursive":true}']
           chmod PATH 755
           move --input '{"sourcePath":"old","targetPath":"new","overwrite":false}'
Transfer:  upload [-r] LOCAL_PATH REMOTE_PATH --id ID
           download [-r] REMOTE_PATH LOCAL_PATH --id ID
Git:       git-pull [REMOTE_PATH] --id ID
           git-push [REMOTE_PATH] --id ID
Execute:   exec -- 'COMMAND'
           batch --input '{"operations":[{"command":"read","arguments":{"path":"README.md"}}]}'
Named --path, --query and --command options are supported. --workspace is an alias for --id.
Use --input JSON|- for structured arguments; stdin avoids putting sensitive content in arguments.
Options: --compact omits empty status metadata; --verbose prints exec as JSON; --version prints version.
Batch runs in order and stops at the first failure; completed changes are not rolled back.
`;
