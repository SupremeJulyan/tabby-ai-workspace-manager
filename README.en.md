# ai-workspace-manager for Tabby

[简体中文](README.md) | [English](README.en.md)

UI preview: [demo.png](docs/images/demo.png)

Remote workspaces offer the same file browsing, editing, preview, and Git experience as local workspaces, with seamless switching as you move between terminals.

Manage local and remote workspaces together in Tabby, switching seamlessly with the active terminal. Open a local terminal to browse local files; switch to an SSH terminal to browse that server's files and restore the tab's directory and view.

Use the same sidebar to browse workspaces, edit files, upload and download, preview content, and manage Git. Open an AI terminal with one click, and let locally installed tools such as Codex and Claude work on remote workspaces through Tabby's existing SSH connection.

Package: `tabby-ai-workspace-manager` · CLI: `arw` · Version: `1.0.0`

## What you can do

| Feature | How it helps |
| --- | --- |
| Seamless local / remote switching | Automatically follow the active terminal and restore each tab’s browsing directory and view. |
| Manage multiple workspaces | Save local and remote workspace directories, switch workspaces, and open an AI terminal for each workspace. |
| Let AI work on remote workspaces | Use a local AI CLI with `arw` to browse, search, read and write remote files, and run commands. |
| Browse and edit files | Expand directories, filter filenames, and open text files to edit and save. |
| Upload files and directories | Drag items from your desktop file manager into the remote explorer, upload directories recursively, and view or cancel the current upload. |
| Download remote files and directories | Right-click to download with Tabby's save dialog and transfer progress. |
| Preview files | View images, PDFs, Markdown, and CSV/TSV tables with filtering and pagination. |
| Manage Git | Review diffs, stage, commit, revert, switch branches, and initialize or clone repositories. |
| Synchronize Git | Fetch, pull, and push local workspaces directly; relay remote workspaces' pulls and pushes through your local network and credentials. |
| Manage AI sessions | Configure launch and recovery arguments, tile multiple AI terminals, and continue sessions with Tabby's tab recovery. |
| Review AI operations | View ARW file operations and commands in **AI activity**, with workspace labels, types, and statuses. |

## Installation

Development and verification environment: Node.js 22+, npm, Git, and Tabby 1.0.238.

Build the installation package from the plugin source directory:

```sh
npm ci
npm run check
npm run pack:plugin
```

In Tabby, open **Settings → Plugins → Open Plugins Directory**, then run this in that directory:

```sh
npm install --omit=dev --legacy-peer-deps /absolute/path/to/artifacts/tabby-ai-workspace-manager-1.0.0.tgz
```

Fully quit and restart Tabby.

## Quick start

1. Open a local terminal or connect through SSH, then wait for the explorer to load.
2. Browse to your workspace directory and click `+` next to the workspace heading to save it.
3. In **Tabby Settings → ai-workspace-manager**, enter an installed and authenticated AI CLI command, such as `codex` or `claude`.
4. Click **AI** next to the saved workspace and enter your development task in its AI terminal.
5. For remote workspaces, AI can use `arw` to read code, edit files, and run commands. Review these operations in **AI activity**.

## Workspaces and files

### Switch workspaces and directories

Local terminals show **AI Local Workspace**; SSH terminals show **AI Remote Workspace**. Click a saved workspace's folder button to browse it, or **AI** to open its AI terminal.

Double-click a directory to enter it, or click its arrow to expand it. The path bar supports directory completion: Up/Down selects a candidate, Tab or Right at the end accepts it, and Enter opens the directory. Use the location arrow to follow the terminal's current directory. Enable session-level Bash/Zsh/Fish path detection when needed.

Each top-level tab remembers its directory, expanded nodes, and Git view. Terminal and AI splits within that tab share this state. Drag to resize the sidebar; colors and fonts follow Tabby's settings.

Saving a remote workspace starts ARW forwarding. Workspace status icons show connection progress, forwarding status, or errors; hover for recent error details. After reconnecting SSH, load the corresponding terminal to restore forwarding.

### Upload and download

Plugin saves and uploads update the file tree immediately. Changes from remote terminals or other programs use SAFS-style metadata checks every 5 seconds for the current directory, expanded directories, and Git repositories; local workspaces use native Node.js file events. Detected changes refresh silently, and only a manual refresh shows loading indicators. Open text files with no local modifications are re-read when detected changes arrive; unsaved or unconfirmed edits are preserved. Switching tabs restores cached file and Git state. Reads prefer Tabby SSH's SFTP session; editor saves use a dedicated command channel on the same SSH connection.

Drag local files or directories from your desktop file manager into the remote explorer:

- **Onto a directory row**: Upload into that directory.
- **Onto a file row or blank space**: Upload into the current browsing directory.
- **Multiple items**: Upload sequentially, preserving directory structure, including empty directories.

The upload area shows the current item and a cancel button. Existing targets produce an error; completed uploads are retained. Uploads require connected SSH with SFTP and are available in normal file mode.

Right-click a remote file or directory to download it. Choose a destination with Tabby's native dialog and follow the transfer progress. You can also use `arw cp` to upload, download, or copy entire directories.

### Edit and preview

Local and remote editor saves write in place, retaining the original inode's permissions, ACLs, and extended attributes. A remote save uses one command channel for path validation, remote content hashing and metadata conflict checks, payload streaming, and writing. Upload starts after validation; a byte-count check follows writing. setuid/setgid files also restore and verify special permission bits. Remote saves use GNU `realpath`, `stat`, `sha256sum`, and standard file tools, and reject symlinks and hard links. New files default to `0600`. Disconnection can leave partial content; the editor keeps local content and marks the save unconfirmed.

Remote saves have a 30-second deadline and listen for SSH disconnection. Interrupted writes retain editor content. Unsaved edits and unconfirmed saves show a persistent dot in the tab title until resolved. Pending writes block another save. Use **Verify remote file** to compare remote content with the attempted save and check pre-save permissions, owner, and group; mismatches or failed checks retain the warning. Alternatively, confirm discarding local edits and **Reload**; only a successful read clears the warning. Verification and reload also have 30-second deadlines. Warnings survive reconnects using the same SSH profile, host, and account for the current Tabby session.

Open UTF-8 text files to edit and save them, up to 10 MiB per file. Saving checks content hashes and reports conflicts when external changes are detected.

To retain local edits and overwrite the remote file, choose **Save again** and explicitly confirm. Current metadata and permissions are still checked. The warning clears only after a confirmed successful write.

Terminal tab labels stay at their configured profile names. AI pane titles show `local->directory` or `remote->directory`. When leaf directories collide, parent directories are added until names differ, such as `remote->opt/c2_tests` and `remote->srv/c2_tests`. Sidebar workspaces show directory names only, with the same parent-directory disambiguation.

| File type | Preview features | Per-file limit |
| --- | --- | --- |
| PNG, JPEG, GIF, WebP, BMP, SVG, ICO, AVIF, TIFF | Zoom, fit to window, and navigate images in the same directory. TIFF displays the first frame, up to 16 million pixels. | 32 MiB |
| PDF | Page navigation, jump to page, zoom, fit to width, and password entry. | 64 MiB |
| Markdown | Rendered and source views, with workspace-relative images. | 2 MiB |
| CSV / TSV | Delimiter detection, header toggle, filtering, pagination, and source view. | 8 MiB |

Tables display up to 10,000 data rows and 200 columns, with 100 rows per page. Text previews support UTF-8, UTF-16 with a BOM, and a GB18030 fallback. UTF-8 Markdown/CSV files up to 10 MiB can open directly in the editor. Remote image and PDF previews require SFTP.

## Git

After opening a workspace, the plugin finds Git repositories in the current directory and its descendants in the background. Open the Git view to:

- Review working tree changes with side-by-side or unified diffs.
- Stage, unstage, write commit messages, commit, and revert changes after confirmation.
- View the latest 50 commits and switch local branches.
- Initialize a local or remote repository, or clone through local Git into a new folder under the current directory.

Local repositories offer **Fetch / Pull / Push** using local Git, credential helpers, and the SSH agent. Pull uses fast-forward updates; push targets the current branch's configured upstream.

Remote repositories offer **Pull via local / Push via local**, transferring Git objects through your local network and Git credentials. Relay operations show progress stages and support cancellation. After cancellation or failure, inspect repository state before deciding whether to retry.

Commit history shows pending push, pending pull, and on-upstream states. Commits successfully synchronized in the current session also show pushed or pulled markers. These states use the latest known upstream history; fetch to update a local repository's upstream information.

Background discovery is limited to two levels, 60 directories, 10 repositories, 5000 entries (2000 per directory), and three seconds. Partial results are preserved with a limit notice. Automatic Git updates run at least five seconds apart; each background read is limited to three seconds and 256 KiB, and lists exceeding 1000 changes are not rendered. Local monitoring watches up to 32 visible directories without recursively watching the entire tree. Cancel a scan or click **Refresh Git** to rescan the current scope. Git operations preserve browsing position, expanded nodes, and commit drafts.

## AI terminals

### Configure your AI tool

In **Tabby Settings → ai-workspace-manager**, configure:

| Setting | Example | Purpose |
| --- | --- | --- |
| AI CLI command or full path | `codex`, `claude` | Choose an installed and authenticated local AI tool. |
| Launch arguments | One argument per line | Configure the model, options, or initial arguments for new sessions. |
| Recovery arguments | `resume` and `--last` on separate lines | Configure arguments for continuing existing sessions. |
| HTTP / HTTPS proxy URL | `http://127.0.0.1:7897` | Set a proxy for new local AI terminals; leave empty to inherit the environment. |
| AI terminal environment variables | `OPENAI_API_KEY your_value` | One `NAME VALUE` pair per line, injected when the AI process starts. |

Launch and recovery arguments apply separately; enter shared options in both lists. For Codex recovery, use `resume` and `--last`; for Claude, use `--continue`. Enable Tabby's tab recovery to continue AI sessions after restarting. Set a session ID to recover a specific conversation.

Environment values may contain spaces and are saved as plain text in configuration. The settings page masks them by default; click the eye button to reveal them. Reopen AI terminals after saving proxy or environment settings.

### Use multiple AI terminals

Open multiple AI terminals within one tab. Panes tile automatically with the source terminal on the left. Collapse an AI pane to free its space. The adjacent AI terminal's expand button shows the number of collapsed panes; click it to restore sessions one at a time. Click × in an AI pane's upper-right corner to close it.

Local AI runs in the workspace directory. Remote AI runs in a stable local placeholder directory and receives ARW instructions through its `AGENTS.md`; remote operations use the connected SSH workspace.

A remote tab's **AI activity** view combines ARW file operations and commands from that tab. It shows workspace, execution status, duration, exit code, and errors, with filters for type and status.

### Use your interactive terminal environment

In a remote workspace, enable **Terminal mode** at the top to run the agent's `arw exec` in the source interactive terminal, using its current user, working directory, and exported environment variables. This is useful for tasks that rely on an activated virtual environment or a manually prepared shell environment.

Enable it at a shell prompt and use shell commands for file operations. Results return as combined PTY output. After the terminal directory changes, synchronize again and open an AI terminal. Disable terminal mode to resume normal file forwarding.

## ARW CLI

Find saved remote workspaces, then select the target with `--id ID`:

```sh
arw workspaces
arw list src --id ID
arw read README.md --id ID
arw write notes.txt --id ID --content 'hello'
arw exec --id ID -- 'git status --short'
```

All remote operations use `--id ID`, also available as `--workspace ID`. One AI session can work with multiple forwarded workspaces.

| Operation | Example (append `--id ID`) |
| --- | --- |
| Current editor file | `current-file` |
| Paginated directory listing | `list src --limit 100 --cursor CURSOR` |
| Read a file | `read README.md --head 40` |
| Read a range | `read app.ts --offset 0 --length 4096` or `read app.ts --start-line 20 --line-count 40` |
| Read multiple files | `read-many --input '{"requests":[{"path":"README.md","head":40}],"maxBytes":65536}'` |
| Search content | `search TODO src --mode content` |
| Search filenames | `find '*.ts' src` |
| Exact replacement | `edit app.ts --input '{"edits":[{"oldText":"old","newText":"new"}]}'` |
| Create a file or directory | `create notes.txt file`, `create docs directory` |
| Delete | `delete notes.txt`; add `--input '{"recursive":true}'` for nonempty directories. |
| Move | `move --input '{"sourcePath":"old","targetPath":"new"}'` |
| Change permissions | `chmod script.sh 755` |
| Upload | `cp ./local-file remote:path` |
| Download | `cp remote:path ./local-file` |
| Upload or download directories | `cp -r ./folder remote:path`, `cp -r remote:path ./folder` |
| Ordered batch | `batch --input '{"operations":[{"command":"read","arguments":{"path":"README.md"}}]}'` |
| Continue reading command output | `output OUTPUT_ID stdout --offset N --length N` |

Use `arw --help` for complete options and `arw --version` for the version. `--input -` reads JSON from stdin; `--file -` for `write` and `create` reads text from stdin. `--compact` reduces JSON metadata; `exec --verbose` outputs JSON.

In copy commands, `remote:` identifies paths in the selected workspace. Relative local paths start at the CLI's current directory and may use a `local:` prefix. When the destination is an existing directory, the source item goes inside it. Existing targets produce an error. Directory copies require `-r`.

Search supports content, filename, and count modes. Configure `fixedStrings`, `ignoreCase`, `include`, and `excludeDirs` through `--input`. Defaults inspect up to 10,000 directory entries and 8 MiB of text, returning up to 1,000 results. `truncated` indicates remaining scan work or results. Text reads support files up to 10 MiB.

Batches run up to 50 operations sequentially, stop on error, and return individual results. When `exec` output exceeds 64 KiB, it returns `outputId` and `nextOffsets` for continued reading with `output`. Command output is limited to 8 MiB; each connection retains the latest four long outputs.

AI terminals already include `arw`. On Linux/macOS, installation or first plugin load creates `~/.local/bin/arw`. If needed, PATH is configured for Bash, Zsh and fish for new terminals. Uninstalling through Tabby removes the owned link and PATH configuration. Before a manual command-line uninstall, run `npm run uninstall:cli`. Use `TABBY_CONFIG_DIRECTORY` for a custom Tabby configuration directory.

## Operation safeguards and logs

ARW checks workspace boundaries and real paths for remote operations and blocks high-risk commands. Editor saves check content hashes; uploads publish completed temporary files. Combine these with restricted remote accounts, containers, and system access controls to manage AI tool permissions.

Audit logs at `<Tabby config directory>/omw/audit.jsonl` record operation metadata, rotate at about 1 MiB, and retain one backup. Workspace status icons expose the five most recent redacted errors. Git operation details appear in the corresponding repository panel.

## Development

```sh
npm run build          # Compile TypeScript and build the plugin and CLI
npm test               # Run unit and integration tests; build first
npm run check          # Build and run all tests
npm run pack:plugin    # Generate an installation package under artifacts/
npm run dev -- /opt/Tabby/tabby
```

Development mode uses separate userData and plugin directories. For desktop checks, enable a DevTools port in a test configuration and run `node scripts/smoke-tabby.mjs PORT`.

```text
src/
  arw-tree/      Directory tree, Git, editor, and sidebar
  arw-cli/       CLI, forwarding, operation policies, and activities
  arw-ai-cli/    AI launcher, settings, and placeholder directories
  services/      Workspace registry and Git relay
  adapters/      SSH/SFTP host adapters
  shared/        Command execution and shell integration
test/            Unit and integration tests
```

See the [architecture documentation (Chinese)](docs/architecture.md) for implementation details.

## Publishing

Use an npm account authorized to publish `tabby-ai-workspace-manager`, and run from the plugin source root:

```sh
npm ci
npm run check
npm login --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

Complete login and two-factor verification as prompted. The publishing hook runs the build and tests. Verify the release:

```sh
npm view tabby-ai-workspace-manager@1.0.0 version --registry=https://registry.npmjs.org/
npm search --searchlimit=250 --registry=https://registry.npmjs.org/ 'keywords:tabby-plugin tabby-ai-workspace-manager'
```

After npm's search index updates, search for `ai-workspace-manager` in Tabby's **Settings → Plugins**, install, and restart. Increase the version for subsequent releases.

References: [Tabby plugin development](https://github.com/Eugeny/tabby/blob/master/HACKING.md#plugins), [Publishing public npm packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## License

[MIT](LICENSE)
