import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { shellQuote } from '../shared/shell-quote';

type Run = (command: string) => Promise<unknown>;

export function remoteSnapshotDiffCommand(root: string, before: string, after?: string): string {
  const ids = after === undefined ? [before] : [before, after];
  if (ids.some(id => !/^[0-9a-f-]{36}$/.test(id))) throw new Error('Invalid snapshot ID');
  const key = createHash('sha256').update(root).digest('hex');
  return [
    '(',
    'set -eu',
    'umask 077',
    `repo="$HOME/.arw-snapshots/${key}.git"`,
    'scratch=$(mktemp -d "$HOME/.arw-snapshots/.diff.XXXXXXXX")',
    'trap \'rm -rf -- "$scratch"\' EXIT',
    'cd -- "$scratch"',
    'mkdir before after',
    ...ids.flatMap((id, index) => [
      `git --git-dir="$repo" cat-file blob refs/arw/snapshots/${id}:files.tar > files.tar`,
      `tar --extract --file=files.tar --directory=${index === 0 ? 'before' : 'after'} --no-same-owner --no-same-permissions`,
    ]),
    'status=0',
    'git --no-pager diff --no-index --no-ext-diff --no-textconv -- before after || status=$?',
    'test "$status" -le 1',
    ')',
  ].join('\n');
}

/** Store exact file bytes and metadata without using the project's Git index. */
export async function saveRemoteSnapshot(run: Run, root: string, operation: string, targets: string[]): Promise<string> {
  const snapshotId = randomUUID();
  const workspaceKey = createHash('sha256').update(root).digest('hex');
  const paths = [...new Set(targets)].map(target => posix.relative(root, target));
  if (paths.some(path => !path || path === '..' || path.startsWith('../'))) {
    throw new Error('Snapshot paths must be inside the workspace');
  }
  const manifest = JSON.stringify({ version: 1, snapshotId, operation, paths, createdAt: new Date().toISOString() });
  const command = [
    '(',
    'set -eu',
    'umask 077',
    'base="$HOME/.arw-snapshots"',
    'test ! -L "$base"',
    'mkdir -p -- "$base"',
    'base=$(cd -P -- "$base" && pwd -P)',
    `root=${shellQuote(root)}`,
    'case "$base/" in "$root/"*|"$root") echo "Snapshot storage overlaps the workspace" >&2; exit 1;; esac',
    `repo="$base/${workspaceKey}.git"`,
    'test ! -L "$repo"',
    'if test ! -f "$repo/HEAD"; then git init --quiet --bare "$repo"; fi',
    'scratch=$(mktemp -d "$base/.snapshot.XXXXXXXX")',
    'trap \'rm -rf -- "$scratch"\' EXIT',
    `set -- ${paths.map(shellQuote).join(' ')}`,
    'cd -- "$root"',
    'for path do',
    '  test "$(realpath -m -- "$path")" = "$root/$path"',
    '  if test -e "$path" || test -L "$path"; then',
    '    printf "%s\\000" "$path" >> "$scratch/present"',
    '  fi',
    'done',
    'touch "$scratch/present"',
    'tar --create --file="$scratch/files.tar" --null --files-from="$scratch/present"',
    `manifest=$(printf "%s" ${shellQuote(manifest)} | git --git-dir="$repo" hash-object -w --stdin)`,
    'archive=$(git --git-dir="$repo" hash-object -w --no-filters "$scratch/files.tar")',
    'tree=$(printf "100644 blob %s\\tmanifest.json\\n100644 blob %s\\tfiles.tar\\n" "$manifest" "$archive" | git --git-dir="$repo" mktree)',
    `git --git-dir="$repo" update-ref refs/arw/snapshots/${snapshotId} "$tree"`,
    ')',
  ].join('\n');
  try {
    await run(command);
  } catch (error) {
    throw new Error('Remote snapshot failed. The file operation did not start.', { cause: error });
  }
  return snapshotId;
}
