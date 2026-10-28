export const cliGuidance = `# ARW remote workspace

This local directory is a placeholder, not a project copy or mount. Read .awm/workspace.json locally for metadata; use arw for all remote project files, Git, builds, tests and commands. Do not create or edit project files in the placeholder.

Run arw workspaces and match host, port, user and workspaceRoot against the metadata (remoteRoot). Use --id ID for every operation on that forwarded workspace. Ask the user if ambiguous; if unavailable, have it reconnected in Tabby. Never switch targets implicitly.

Before working, discover and read applicable remote project instructions, including AGENTS.md at the project root and along the directories containing files you will change. They are not automatically loaded here.

Run arw --help for the command index and arw COMMAND --help for syntax, path rules, limits and examples. Inspect incomplete results before drawing conclusions. Use arw output to continue stored command output instead of rerunning the command.

Keep mutations inside workspaceRoot. Do not bypass POLICY_DENIED or expose connection URLs, tokens or credentials.
`;

export const terminalCliGuidance = `# ARW terminal mode

This local directory is a placeholder, not a project copy or mount. Read .awm/workspace.json locally for metadata; do not create or edit project files here.

Run arw workspaces and verify the exact workspaceId from the metadata is forwarded. Use --id ID for each operation. If unavailable, reopen the AI terminal in terminal mode; never substitute another workspace with the same path.

Use arw exec for all project operations in the existing terminal, and arw output for stored output. Keep operations inside remoteRoot from the metadata. The terminal must be at a shell prompt; if its directory changes, resynchronize it in Tabby and reopen the AI terminal.

Before working, discover and read applicable remote project instructions, including AGENTS.md at the project root and along the directories containing files you will change. They are not automatically loaded here.

Run arw --help for the command index and arw COMMAND --help for syntax, terminal behavior, limits and examples. Inspect incomplete results and continue stored output instead of rerunning commands. Do not bypass POLICY_DENIED or expose connection URLs, tokens or credentials.
`;
