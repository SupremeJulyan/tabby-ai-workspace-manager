import { t } from '../../shared/i18n'
import type { RemoteGit } from './remote-git';
import { GitCommit, parseGitHistory } from './git-history';

export async function readCommitSyncHistory(git:RemoteGit,commits:GitCommit[],state:GitSyncState|undefined,pushed=new Set<string>(),pulled=new Set<string>()):Promise<GitCommit[]> {
  if(state?.kind!=='tracked'||!state.head||!state.upstreamOid)return commits.map(commit=>({...commit,syncStatus:'unknown'}));
  const commands:string[][]=[];
  const hasOutgoing=state.head!==state.upstreamOid&&state.ahead!==0;
  const hasIncoming=state.head!==state.upstreamOid&&state.behind!==0;
  if(hasOutgoing)commands.push(['rev-list',state.head,'--not',state.upstreamOid,'--']);
  if(hasIncoming)commands.push(['log','--no-color','--max-count=50','--format=%x1e%H%x1f%an%x1f%aI%x1f%P%x1f%s%x1d',state.upstreamOid,'--not',state.head,'--']);
  const results=await git.batch(commands);
  for(const result of results)if(result.exitCode!==0)throw new Error(result.stderr.trim()||'Cannot read Git sync history');
  const outgoing=new Set(hasOutgoing?results.shift()!.stdout.trim().split('\n').filter(Boolean):[]);
  const incoming=hasIncoming?parseGitHistory(results.shift()!.stdout):[];
  return [...incoming.map(commit=>({...commit,syncStatus:'incoming' as const})),...commits.map(commit=>({...commit,
    syncStatus:outgoing.has(commit.hash)?'unpushed' as const:pushed.has(commit.hash)?'pushed' as const:pulled.has(commit.hash)?'pulled' as const:'synced' as const}))];
}

export interface GitSyncState {
  branch: string;
  head?: string;
  upstream?: string;
  upstreamOid?: string;
  ahead?: number;
  behind?: number;
  /** The upstream OID is known from a local relay push but is not present on this host yet. */
  observedUpstream?: boolean;
  kind: 'tracked' | 'unborn' | 'detached' | 'no-upstream' | 'missing-upstream' | 'unknown';
}

export interface ObservedPushState {
  oid: string;
  previousOid?: string;
  pushedCommits: number;
}

export function applyObservedPushState(
  state: GitSyncState, observed: ObservedPushState | undefined
): GitSyncState {
  if (!observed || state.kind !== 'tracked' || state.upstreamOid !== observed.previousOid
    || state.head === observed.oid) return state;
  return {
    ...state, upstreamOid: observed.oid,
    behind: Math.max(1, observed.pushedCommits || 1), observedUpstream: true
  };
}

/** Resolve the configured fetch refspec, including upstreams with a different branch name. */
export async function trackingRef(git: RemoteGit, branch: string): Promise<string | undefined> {
  const result = await git.run(['for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`]);
  return result.trim() || undefined;
}

export async function readGitSyncState(git: RemoteGit): Promise<GitSyncState> {
  const [branchResult, headResult] = await git.batch([
    ['symbolic-ref', '--short', '--quiet', 'HEAD'],
    ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']
  ]);
  for (const result of [branchResult, headResult]) {
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr.trim() || 'Cannot read Git state');
  }
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : undefined;
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() : undefined;
  if (!head) return { branch: branch || 'HEAD', kind: 'unborn' };
  if (!branch) return { branch: 'HEAD', head, kind: 'detached' };
  const upstream = await trackingRef(git, branch);
  if (!upstream) return { branch, head, kind: 'no-upstream' };
  const upstreamOid = (await git.probe(['rev-parse', '--verify', '--quiet', `${upstream}^{commit}`]))?.trim();
  if (!upstreamOid) return { branch, head, upstream, kind: 'missing-upstream' };
  if(head===upstreamOid)return {branch,head,upstream,upstreamOid,ahead:0,behind:0,kind:'tracked'};
  // Compare immutable object IDs so an external fetch cannot mix two snapshots.
  const counts = (await git.run(['rev-list', '--left-right', '--count', `${head}...${upstreamOid}`])).trim().split(/\s+/);
  if (counts.length !== 2 || counts.some(count => !/^\d+$/.test(count))) throw new Error('Invalid Git ahead/behind counts');
  return { branch, head, upstream, upstreamOid, ahead: Number(counts[0]), behind: Number(counts[1]), kind: 'tracked' };
}

export function syncStateLabel(state: GitSyncState): string {
  switch (state.kind) {
    case 'unborn': return t('尚无提交');
    case 'detached': return t('游离 HEAD · 推送状态未知');
    case 'no-upstream': return t('已提交 · 未配置上游');
    case 'missing-upstream': return t('上游尚未提取或已删除');
    case 'unknown': return t('同步状态读取失败');
    case 'tracked': {
      const labels: string[] = [];
      if (state.ahead) labels.push(t`已提交待推送 ↑${state.ahead}`);
      if (state.behind) labels.push(t`待拉取 ↓${state.behind}`);
      return labels.length ? labels.join(' · ') : t('已推送 · 与上游同步');
    }
  }
}
export function syncStateTooltip(state: GitSyncState): string {
  return `${state.branch}：${syncStateLabel(state)}\n`
    + (state.upstream ? t`比较目标：${state.upstream}\n` : '')
    + t('相对于最近一次提取/推送记录的上游状态；点击“提取”检查服务器的新提交。');
}
