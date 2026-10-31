import { t } from '../../shared/i18n'
import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { RemoteGit, type GitResult } from './remote-git';
import { createRemoteGitBundle } from './remote-git-bundle';
import { localGitRunner, pushThroughLocalGit, resolvePushTarget, resolveShallowBoundaries, recordSuccessfulPush,
  type LocalGitRunner } from './local-git-push';
import { pullThroughLocalGit, resolvePullTarget, fetchThroughLocalGit, resolveFetchTarget, type LocalPullResult } from './local-git-pull';

export interface RelayTransport {
  root: string;
  run(command: string, signal?: AbortSignal): Promise<GitResult>;
  download(remote: string, local: string, signal?: AbortSignal): Promise<void>;
  upload(local: string, remote: string, signal?: AbortSignal): Promise<void>;
  remove(remote: string): Promise<void>;
}
export interface RelayOptions {
  storagePath: string;
  local?: LocalGitRunner;
  signal?: AbortSignal;
  report?(message: string): void;
}

/** Orchestrates bundles only; no local working copy and no remote network access. */
export async function relayGit(
  direction: 'fetch' | 'pull' | 'push', transport: RelayTransport, options: RelayOptions
): Promise<LocalPullResult | undefined> {
  if(direction==='fetch')return relayFetch(transport,options);
  const { signal, report } = options;
  signal?.throwIfAborted();
  const git = new RemoteGit(command => transport.run(command, signal));
  const target = direction === 'pull' ? await resolvePullTarget(git) : await resolvePushTarget(git);
  const branchRef = `refs/heads/${target.branch}`;
  const shallowBoundaries = await resolveShallowBoundaries(git, branchRef);
  const verifyRemote = async () => {
    const head = (await git.run(['symbolic-ref', '--quiet', 'HEAD'])).trim();
    const oid = (await git.run(['rev-parse', '--verify', `${branchRef}^{commit}`])).trim();
    if (head !== branchRef || oid !== target.oid) throw new Error(t('中转期间远端分支发生变化，请重试。'));
  };
  const temporary = async () => posix.resolve(transport.root,
    (await git.run(['rev-parse', '--git-path', `arw-${randomBytes(24).toString('hex')}.bundle`])).trim());
  const cleanup = async (remote: string) => {
    for (const file of [remote, `${remote}.lock`]) {
      await transport.remove(file).catch(() => report?.(t('Git 中转临时文件清理失败，请检查远端仓库。')));
    }
  };
  const shared = {
    storagePath: options.storagePath, local: options.local ?? localGitRunner(),
    signal, report, shallowBoundaries, verifyRemote,
    downloadBundle: async (local: string, exclusions?: string[]) => {
      await verifyRemote();
      const remote = await temporary();
      try {
        await createRemoteGitBundle(git, remote, branchRef, exclusions);
        await transport.download(remote, local, signal);
        await verifyRemote();
      } finally { await cleanup(remote); }
    }
  };
  if (direction === 'push') {
    const pushTarget = target as Awaited<ReturnType<typeof resolvePushTarget>>;
    await pushThroughLocalGit({ ...shared, target: pushTarget });
    await recordSuccessfulPush(git, pushTarget).catch(() => report?.(t('推送成功，但跟踪引用更新失败，请重新提取。')));
    return undefined;
  }
  const pullTarget = target as Awaited<ReturnType<typeof resolvePullTarget>>;
  const previous = (await git.probe(['rev-parse', '--verify', '--quiet', pullTarget.tracking]))?.trim();
  const result = await pullThroughLocalGit({ ...shared, target: pullTarget,
    deliverBundle: async (local, expected) => {
      const remote = await temporary();
      try {
        await transport.upload(local, remote, signal);
        await verifyRemote();
        await git.run(['fetch', '--no-tags', remote, `+refs/heads/arw-pull:${pullTarget.tracking}`]);
        await verifyRemote();
        await git.run(['merge', '--ff-only', pullTarget.tracking]);
        if ((await git.run(['rev-parse', '--verify', `${branchRef}^{commit}`])).trim() !== expected) {
          throw new Error(t('合并后远端提交与预期不一致，请检查仓库。'));
        }
      } finally { await cleanup(remote); }
    }
  });
  if (result.status === 'up-to-date' && result.upstreamOid) {
    await verifyRemote();
    await git.run(['update-ref', pullTarget.tracking, result.upstreamOid,
      previous ?? '0'.repeat(pullTarget.oid.length)]);
  }
  return result;
}

/** Fetch upstream through local credentials, updating only the remote tracking reference. */
async function relayFetch(transport:RelayTransport,options:RelayOptions):Promise<LocalPullResult> {
  const {signal,report}=options;
  signal?.throwIfAborted();
  const git=new RemoteGit(command=>transport.run(command,signal));
  const target=await resolveFetchTarget(git);
  const verifyRemote=async()=>{
    const current=(await git.probe(['rev-parse','--verify','--quiet',`${target.tracking}^{commit}`]))?.trim()||undefined;
    if(current!==target.base)throw new Error(t('传输期间远端跟踪引用发生变化，请重新提取。'));
  };
  const updateRef=async(oid:string)=>{
    await verifyRemote();
    await git.run(['update-ref',target.tracking,oid,target.base??'0'.repeat(oid.length)]);
  };
  const temporary=async()=>posix.resolve(transport.root,
    (await git.run(['rev-parse','--git-path',`arw-${randomBytes(24).toString('hex')}.bundle`])).trim());
  const cleanup=async(file:string)=>{
    for(const path of [file,`${file}.lock`])await transport.remove(path).catch(()=>report?.(t('Git 中转临时文件清理失败，请检查远端仓库。')));
  };
  return fetchThroughLocalGit({storagePath:options.storagePath,local:options.local??localGitRunner(),target,signal,report,verifyRemote,updateRef,
    shallowBoundaries:target.base?await resolveShallowBoundaries(git,target.tracking):[],
    downloadBundle:async(local,exclusions)=>{
      await verifyRemote();
      const remote=await temporary();
      try{
        await createRemoteGitBundle(git,remote,target.tracking,exclusions);
        await transport.download(remote,local,signal);
        await verifyRemote();
      }finally{await cleanup(remote);}
    },
    deliverBundle:async(local,expected)=>{
      const remote=await temporary(),ref=`refs/arw/fetch/${randomBytes(24).toString('hex')}`;
      try{
        await transport.upload(local,remote,signal);
        await verifyRemote();
        await git.run(['fetch','--no-tags',remote,`+refs/heads/arw-pull:${ref}`]);
        if((await git.run(['rev-parse','--verify',`${ref}^{commit}`])).trim()!==expected)throw new Error('Invalid fetched commit');
        await updateRef(expected);
      }finally{await git.run(['update-ref','-d',ref]).catch(()=>{});await cleanup(remote);}
    }
  });
}
