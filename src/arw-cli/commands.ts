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
  write: { tool: 'remote_write', positional: ['path'], fields: ['path', 'content', 'allowEmpty'] },
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
       arw COMMAND --help
       Commands: workspaces, list, read, read-many, search, find, write, edit, create,
                 delete, chmod, move, upload, download, git-pull, git-push, exec, output, batch
`;

const commandHelp: Record<string, string> = {
  workspaces: `Usage: arw workspaces`,
  list: `Usage: arw list [PATH] [--limit N] [--cursor N] [--input JSON] [--id ID]`,
  read: `Usage: arw read [PATH] [--offset N --length N | --head N | --tail N | --start-line N --line-count N] [--input JSON] [--id ID]`,
  'read-many': `Usage: arw read-many --input JSON [--id ID]`,
  search: `Usage: arw search [QUERY] [PATH] [--name GLOB] [--mode content|files|count|names] [--limit N] [--input JSON] [--id ID]`,
  find: `Usage: arw find [GLOB] [PATH] [--name GLOB] [--limit N] [--input JSON] [--id ID]`,
  write: `Usage: arw write [PATH] (--content FULL_TEXT | --file LOCAL_FILE | --file - | --input JSON) [--allow-empty] [--id ID]`,
  edit: `Usage: arw edit [PATH] --input JSON [--id ID]`,
  create: `Usage: arw create [PATH] [file|directory] [--content TEXT | --file FILE | --file - | --input JSON] [--id ID]`,
  delete: `Usage: arw delete [PATH] [-r] [--input JSON] [--id ID]`,
  chmod: `Usage: arw chmod [PATH] [MODE] [--input JSON] [--id ID]`,
  move: `Usage: arw move --input JSON [--id ID]`,
  exec: `Usage: arw exec [COMMAND | --command COMMAND | --file SCRIPT | --file - | --input JSON] [--id ID] [--raw]`,
  output: `Usage: arw output [OUTPUT_ID] [stdout|stderr] [--offset N --length N] [--input JSON] [--id ID]`,
  upload: `Usage: arw upload [-r] [LOCAL_PATH] [REMOTE_PATH] [--input JSON] [--id ID]`,
  download: `Usage: arw download [-r] [REMOTE_PATH] [LOCAL_PATH] [--input JSON] [--id ID]`,
  'git-pull': `Usage: arw git-pull [REMOTE_PATH] [--input JSON] [--id ID]`,
  'git-push': `Usage: arw git-push [REMOTE_PATH] [--input JSON] [--id ID]`,
  batch: `Usage: arw batch --input JSON [--id ID]`,
};

export function helpForCommand(command: string): string {
  if (!Object.hasOwn(commands, command) || !Object.hasOwn(commandHelp, command)) {
    throw new Error('Unsupported command; use --help');
  }
  return commandHelp[command]+'\n';
}
