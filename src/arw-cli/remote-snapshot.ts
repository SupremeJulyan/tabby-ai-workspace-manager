import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { shellQuote } from '../shared/shell-quote';

type Run = (command: string) => Promise<unknown>;

const restoreScript = String.raw`
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

root, key, before, after = sys.argv[1:]
root = Path(root)
repo = Path.home() / '.arw-snapshots' / (key + '.git')
def git(*args, **kwargs):
    return subprocess.check_output(['git', '--git-dir', str(repo), *args], **kwargs)
def ref(snapshot, name):
    return 'refs/arw/snapshots/' + snapshot + ':' + name
paths = json.loads(git('cat-file', 'blob', ref(before, 'manifest.json')))['paths']
if not paths or any(Path(p).is_absolute() or '..' in Path(p).parts or p in ('', '.') for p in paths):
    raise SystemExit('Invalid snapshot paths')
if any(a != b and b.startswith(a + '/') for a in paths for b in paths):
    raise SystemExit('Overlapping snapshot paths cannot be restored')
paths = list(dict.fromkeys(paths))

def validate():
    for p in paths:
        target = root / p
        if target.resolve() != target or target.is_symlink() or not target.parent.is_dir():
            raise RuntimeError('The target path or its parent changed: ' + p)
    present = [p for p in paths if os.path.lexists(root / p)]
    if not after:
        if present:
            raise RuntimeError('A deleted path now exists. Restore stopped.')
        return
    with tempfile.TemporaryFile() as archive:
        subprocess.run(['tar', '--create', '--file=-', '--null', '--files-from=-'],
                       cwd=root, input=b''.join(os.fsencode(p) + b'\0' for p in present),
                       stdout=archive, check=True)
        archive.seek(0)
        actual = git('hash-object', '--stdin', stdin=archive).strip()
    expected = git('rev-parse', ref(after, 'files.tar')).strip()
    if actual != expected:
        raise RuntimeError('Files changed after the operation. Restore stopped.')

validate()
stage = Path(tempfile.mkdtemp(prefix='.arw-restore-', dir=root))
saved = []
published = []
keep = False
try:
    original = stage / 'original'
    original.mkdir()
    with (stage / 'before.tar').open('wb') as archive:
        subprocess.run(['git', '--git-dir', str(repo), 'cat-file', 'blob', ref(before, 'files.tar')],
                       stdout=archive, check=True)
    subprocess.run(['tar', '-xpf', str(stage / 'before.tar'), '-C', str(original), '--no-same-owner'], check=True)
    validate()
    for index, p in enumerate(paths):
        target = root / p
        if os.path.lexists(target):
            backup = stage / str(index)
            os.rename(target, backup)
            saved.append((backup, target))
    for p in paths:
        source, target = original / p, root / p
        if os.path.lexists(source):
            if os.path.lexists(target):
                raise RuntimeError('A path appeared during restore: ' + p)
            os.rename(source, target)
            published.append((source, target))
except BaseException:
    try:
        for source, target in reversed(published):
            os.rename(target, source)
        for backup, target in reversed(saved):
            if os.path.lexists(target):
                raise RuntimeError('Path occupied during rollback: ' + str(target))
            os.rename(backup, target)
    except BaseException:
        keep = True
        print('Restore interrupted. Recovery files: ' + str(stage), file=sys.stderr)
    raise
finally:
    if not keep:
        shutil.rmtree(stage)
`;

export function remoteSnapshotRestoreCommand(root: string, before: string, after?: string): string {
  if (![before, ...(after ? [after] : [])].every(id => /^[0-9a-f-]{36}$/.test(id))) {
    throw new Error('Invalid snapshot ID');
  }
  const key = createHash('sha256').update(root).digest('hex');
  return ['python3', '-c', restoreScript, root, key, before, after ?? ''].map(shellQuote).join(' ');
}

export function remoteSnapshotDiffCommand(root: string, before: string): string {
  if (!/^[0-9a-f-]{36}$/.test(before)) throw new Error('Invalid snapshot ID');
  const key = createHash('sha256').update(root).digest('hex');
  return [
    '(',
    'set -eu',
    'umask 077',
    `repo="$HOME/.arw-snapshots/${key}.git"`,
    'scratch=$(mktemp -d "$HOME/.arw-snapshots/.diff.XXXXXXXX")',
    'trap \'rm -rf -- "$scratch"\' EXIT',
    'cd -- "$scratch"',
    'mkdir before current',
    `git --git-dir="$repo" cat-file blob refs/arw/snapshots/${before}:files.tar > before.tar`,
    'tar --extract --file=before.tar --directory=before --no-same-owner --no-same-permissions',
    `git --git-dir="$repo" cat-file blob refs/arw/snapshots/${before}:manifest.json > manifest.json`,
    `python3 -c ${shellQuote(liveArchiveScript)} ${shellQuote(root)}`,
    'tar --extract --file=current.tar --directory=current --no-same-owner --no-same-permissions',
    'status=0',
    'git --no-pager diff --no-index --no-ext-diff --no-textconv -- before current || status=$?',
    'test "$status" -le 1',
    ')',
  ].join('\n');
}

const liveArchiveScript = String.raw`
import json, os, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1])
with open('manifest.json', encoding='utf-8') as manifest:
    paths = json.load(manifest)['paths']
present = []
for p in dict.fromkeys(paths):
    relative = Path(p)
    target = root / relative
    if relative.is_absolute() or '..' in relative.parts or p in ('', '.') or target.parent.resolve() != target.parent:
        raise SystemExit('Snapshot path or its parent changed: ' + p)
    if os.path.lexists(target):
        present.append(os.fsencode(p) + b'\0')
with open('current.tar', 'wb') as archive:
    subprocess.run(['tar', '--create', '--file=-', '--null', '--files-from=-'],
                   cwd=root, input=b''.join(present), stdout=archive, check=True)
`;

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
