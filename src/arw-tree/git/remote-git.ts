import { t } from '../../shared/i18n'
import { operationMetric } from '../../shared/operation-metric';
import { shellQuote } from '../../shared/shell-quote';
import { randomBytes } from 'node:crypto';
import { GitBranch, GitCommit, parseGitBranches, parseGitHistory, parseSwitchError } from './git-history';

export interface GitResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated?: boolean;
}
export type GitRunner = (command: string) => Promise<GitResult>;
export interface GitChange { index: string; working: string; path: string; originalPath?: string }

/** Porcelain -z preserves whitespace, newlines, Unicode and literal pathspec characters. */
export function parseGitStatus(output: string): GitChange[] {
  const records = output.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('Invalid Git status output');
    const change: GitChange = { index: record[0], working: record[1], path: record.slice(3) };
    if (/[RC]/.test(change.index + change.working)) {
      change.originalPath = records[++i];
      if (!change.originalPath) throw new Error('Incomplete Git rename status');
    }
    changes.push(change);
  }
  return changes;
}
export function isGitConflict(change: GitChange): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(change.index + change.working);
}
export function gitCommand(args: string[]): string {
  return `LC_ALL=C LANGUAGE=C GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git --no-pager --literal-pathspecs ${args.map(shellQuote).join(' ')}`;
}

export class RemoteGit {
  private readonly runner: GitRunner;
  constructor(runner: GitRunner, log?: (message: string) => void) {
    this.runner = async command => {
      const started = performance.now();
      try {
        const result = await runner(command);
        operationMetric(log, 'git.remote.command', started,
          Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr));
        return result;
      } catch (error) {
        operationMetric(log, 'git.remote.command', started);
        throw error;
      }
    };
  }
  /** Frame read-only command results in one SSH exec, preserving each exit status and NUL data. */
  async batch(commands: string[][]): Promise<GitResult[]> {
    if (!commands.length) return [];
    const marker = `ARW_GIT_${randomBytes(16).toString('hex')}`;
    const script = commands.map(args =>
      `${gitCommand(args)}; printf '\\000${marker}:%s\\000' "$?"`
    ).join('\n');
    const result = await this.runner(script);
    if (result.truncated) throw new Error('Git output exceeded the capture limit; result was not used.');
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Git batch transport failed');
    const pattern = new RegExp(`\\x00${marker}:(\\d+)\\x00`, 'g');
    const values: GitResult[] = [];
    let offset = 0;
    for (const match of result.stdout.matchAll(pattern)) {
      values.push({ stdout: result.stdout.slice(offset, match.index), stderr: result.stderr,
        exitCode: Number(match[1]) });
      offset = match.index! + match[0].length;
    }
    if (values.length !== commands.length || offset !== result.stdout.length) {
      throw new Error('Incomplete Git batch response');
    }
    return values;
  }
  async configMany(keys: string[]): Promise<Array<string | undefined>> {
    return (await this.batch(keys.map(key => ['config', '--get', key]))).map(result => {
      if (result.exitCode === 1) return undefined;
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Cannot read Git configuration');
      return result.stdout.replace(/\r?\n$/, '');
    });
  }
  async run(args: string[]): Promise<string> {
    const result = await this.runner(gitCommand(args));
    if (result.truncated) throw new Error('Git output exceeded the capture limit; result was not used.');
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Git failed (${result.exitCode})`);
    return result.stdout;
  }
  async config(key: string): Promise<string | undefined> {
    const result = await this.runner(gitCommand(['config', '--get', key]));
    if (result.exitCode === 1 && !result.truncated) return undefined;
    if (result.exitCode !== 0 || result.truncated) throw new Error(result.stderr.trim() || 'Cannot read Git configuration');
    return result.stdout.replace(/\r?\n$/, '');
  }
  /** 允许"不存在"的探测（`rev-parse --verify --quiet`）：退出码 1 返回 undefined，其它错误照抛。 */
  async probe(args: string[]): Promise<string | undefined> {
    const result = await this.runner(gitCommand(args));
    if (result.truncated) throw new Error('Git output exceeded the capture limit; result was not used.');
    if (result.exitCode === 1) return undefined;
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Git failed (${result.exitCode})`);
    return result.stdout;
  }
  async status(): Promise<GitChange[]> {
    return parseGitStatus(await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  }
  async stage(changes: GitChange[]): Promise<void> {
    const paths = changes.flatMap(c => c.originalPath ? [c.path, c.originalPath] : [c.path]);
    if (paths.length) await this.run(['add', '--', ...new Set(paths)]);
  }
  async unstage(changes: GitChange[]): Promise<void> {
    const paths = [...new Set(changes.flatMap(c => c.originalPath ? [c.path, c.originalPath] : [c.path]))];
    if (!paths.length) return;
    // Nearly every repository has HEAD. Try the normal operation immediately so
    // cancelling staging costs one remote round trip instead of probing first.
    try {
      await this.run(['reset', 'HEAD', '--', ...paths]);
      return;
    } catch (resetError) {
      let head: string | undefined;
      try { head = await this.probe(['rev-parse', '--verify', '--quiet', 'HEAD']); }
      catch { throw resetError; }
      if (head) throw resetError;
    }
    // Before the first commit there is no HEAD to restore from. Remove only index entries.
    await this.run(['rm', '--cached', '-f', '--', ...paths]);
  }
  async discard(changes: GitChange[]): Promise<void> {
    if (changes.some(isGitConflict)) throw new Error(t('冲突文件需要先解决冲突，不能直接还原。'));
    const tracked = new Set<string>();
    const untracked = new Set<string>();
    for (const change of changes) {
      (change.index === '?' ? untracked : tracked).add(change.path);
    }
    // Worktree changes are restored from the index so partially staged content stays intact.
    if (tracked.size) await this.run(['restore', '--worktree', '--', ...tracked]);
    // `restore` cannot remove untracked files. Git clean keeps literal pathspec handling and
    // removes only the explicitly selected, non-ignored files reported by status.
    if (untracked.size) {
      await this.run(['clean', '-f', '-d', '--', ...untracked]);
      const remaining = (await this.status()).filter(change => change.index === '?' && [...untracked].some(path =>
        change.path === path || change.path.startsWith(path.endsWith('/') ? path : `${path}/`)));
      if (remaining.length) throw new Error(t`未能删除未跟踪路径：${remaining.map(change => change.path).join('、')}。目录可能包含独立 Git 仓库，已保留以防误删；请检查后在终端处理。`);
    }
  }
  async diff(change: GitChange, staged: boolean): Promise<string> {
    const paths = change.originalPath ? [change.originalPath, change.path] : [change.path];
    return this.run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--unified=3',
      ...(staged ? ['--cached'] : []), '--', ...paths]);
  }
  async commit(message: string): Promise<void> {
    if (!message.trim()) throw new Error(t('请输入提交说明。'));
    await this.run(['-c', 'core.editor=true', 'commit', '-m', message]);
  }
  async history(limit = 50, signal?: AbortSignal): Promise<GitCommit[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid Git history limit');
    signal?.throwIfAborted();
    if (await this.probe(['rev-parse', '--verify', '--quiet', 'HEAD']) === undefined) return [];
    const result = await this.run(['log', '--no-color', `--max-count=${limit}`, '--format=%x1e%H%x1f%an%x1f%aI%x1f%P%x1f%s%x1d', 'HEAD', '--']);
    signal?.throwIfAborted();
    return parseGitHistory(result, limit);
  }
  async branches(signal?: AbortSignal): Promise<GitBranch[]> {
    signal?.throwIfAborted();
    const current = ((await this.probe(['symbolic-ref', '-q', '--short', 'HEAD'])) ?? '').trim();
    signal?.throwIfAborted();
    const output = await this.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    const branches = parseGitBranches(output, current);
    if (current && !branches.some(branch => branch.name === current)) branches.unshift({name:current, current:true});
    return branches;
  }
  async workingChangeCount(signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    const result = await this.runner(gitCommand(['status', '--porcelain=v1', '-z', '--untracked-files=no']));
    signal?.throwIfAborted();
    if (result.truncated) throw new Error('Git status exceeded the capture limit');
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Git failed (${result.exitCode})`);
    return result.stdout ? result.stdout.split('\0').filter(Boolean).length : 0;
  }
  async switchBranch(branch: string): Promise<void> {
    if (!branch || branch.startsWith('-') || /[\u0000-\u001f\u007f]/.test(branch)) throw new Error('Invalid Git branch name');
    try { await this.run(['switch', '--no-guess', '--', branch]); }
    catch (error) { throw parseSwitchError(error); }
  }
  async showCommit(hash: string): Promise<string> {
    if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new Error('Invalid Git commit');
    const header = await this.run(['show', '--no-patch', '--format=%H%n%P', '--no-color', hash]);
    const [commit, parentLine] = header.split('\n');
    if (commit !== hash) throw new Error('Unexpected Git commit response');
    const parents = parentLine.trim().split(/\s+/).filter(Boolean);
    if (parents.some(parent => !/^[0-9a-f]{40,64}$/i.test(parent))) throw new Error('Invalid Git parent commit');
    const patch = parents.length
      ? await this.run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/', parents[0], hash, '--'])
      : await this.run(['show', '--format=', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--root', hash, '--']);
    return patch;
  }
}
