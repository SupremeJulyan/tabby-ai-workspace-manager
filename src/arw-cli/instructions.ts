export const cliGuidance = `# ARW remote workspace

Use arw for all project files, Git, builds, tests and commands in this remote workspace.

Run \`arw workspaces\`. Match its host, port, user and workspaceRoot to \`.awm/workspace.json\` (remoteRoot). Pass \`--id ID\` to every operation on the matching forwarded workspace. If the target is ambiguous, ask the user. If it is saved but unavailable, reconnect it in Tabby. Do not switch targets implicitly.

Use \`arw list\`, \`read\`, \`search\`, \`edit\` and \`write\` for remote files, and \`arw exec --id ID -- 'COMMAND'\` for remote commands. Use \`arw upload [-r] LOCAL_PATH REMOTE_PATH --id ID\` and \`arw download [-r] REMOTE_PATH LOCAL_PATH --id ID\` for transfers. Use \`arw git-pull [PATH] --id ID\` or \`arw git-push [PATH] --id ID\` to relay Git through the local network and credentials. Run \`arw --help\` for syntax.

Report failures without automatically retrying mutations. For long command output, read the returned outputId instead of rerunning the command. A POLICY_DENIED result must not be bypassed. Do not print connection URLs, tokens or credentials.
`;

export const terminalCliGuidance = `# ARW terminal mode

This placeholder represents the selected interactive terminal. Read workspaceId from .awm/workspace.json and verify that exact ID is forwarded in arw workspaces. Pass --id ID to each operation. If it is unavailable, reopen the AI terminal in terminal mode; do not use another workspace with the same path.

Use only arw exec --id ID -- 'COMMAND' for project operations. Commands are injected into the existing terminal and inherit its current user, exported environment, and working directory. Do not pass a cwd. File, search, transfer, and batch tools are disabled in this mode. Read and modify files with shell commands through arw exec.

Keep operations inside workspaceRoot. stdout and stderr are combined because this is a PTY. The terminal must be at a shell prompt. If its directory changes, follow the terminal directory and reopen the AI terminal. Do not automatically retry failed mutations. Do not bypass policy denials.
`;
