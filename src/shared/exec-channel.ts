import { t } from './i18n'
import { randomBytes } from 'node:crypto';
import { shellQuote } from './shell-quote';
import type { GitResult } from '../arw-tree/git/remote-git';

export interface EventSource<T> {
  subscribe(observer: { next(value: T): void; error?(error: unknown): void }): { unsubscribe(): void };
}
export interface ExecChannel {
  data$: EventSource<Uint8Array>;
  extendedData$: EventSource<[number, Uint8Array]>;
  closed$: EventSource<void>;
  requestExec(command: string): Promise<void>;
  write?(data: Uint8Array): Promise<void>;
  eof(): Promise<void>;
  close(): Promise<void>;
}

export interface ExecOptions {
  operation?:string;signal?:AbortSignal;maxBytes?:number;timeoutMs?:number;input?:Uint8Array;
  inputReadyMarker?:string;onStdout?:(output:string)=>void;
}

/** russh does not expose exit-status; require a random trailer from a non-PTY shell. */
export async function executeChannel(
  channel: ExecChannel, command: string, cwd: string,
  options: ExecOptions = {}
): Promise<GitResult> {
  const marker = `ARW_EXIT_${randomBytes(24).toString('hex')}`;
  const script = `sh -c ${shellQuote(`cd -- ${shellQuote(cwd)} || exit $?\n${command}`)}; `
    + `printf '\\000${marker}:%s\\000' "$?"`;
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, settled = false;
    let releaseInput!:()=>void;
    const inputReady=new Promise<void>(resolve=>{releaseInput=resolve});
    if(!options.inputReadyMarker)releaseInput();
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      releaseInput();
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      subscriptions.forEach(subscription => subscription.unsubscribe());
      void channel.close().catch(() => undefined);
      if (error) { reject(error); return; }
      const output = Buffer.concat(stdout).toString('utf8');
      const match = new RegExp(`\\x00${marker}:(\\d{1,3})\\x00$`).exec(output);
      if (!match || Number(match[1]) > 255) {
        reject(new Error(t('SSH 命令未返回完整结果，执行状态未知，请检查远端。')));
        return;
      }
      resolve({ stdout: output.slice(0, match.index), stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: Number(match[1]) });
    };
    const abort = () => finish(new Error(t('操作已取消，远端命令状态需检查。')));
    const timer = setTimeout(() => finish(new Error(t('SSH 命令超时，执行状态未知，请检查远端。'))),
      options.timeoutMs ?? 600_000);
    const append = (target: Buffer[], value: Uint8Array) => {
      bytes += value.byteLength;
      if (bytes > (options.maxBytes ?? 1024 * 1024)) {
        finish(new Error(t('SSH 命令输出超过限制，结果未使用。')));
      } else {
        target.push(Buffer.from(value));
        if(target===stdout&&(options.onStdout||options.inputReadyMarker)){
          const output=Buffer.concat(stdout).toString('utf8');
          try{options.onStdout?.(output)}catch(error){finish(error);return}
          if(options.inputReadyMarker&&output.includes(options.inputReadyMarker))releaseInput();
        }
      }
    };
    subscriptions.push(channel.data$.subscribe({ next: value => append(stdout, value), error: finish }));
    subscriptions.push(channel.extendedData$.subscribe({ next: ([, value]) => append(stderr, value), error: finish }));
    subscriptions.push(channel.closed$.subscribe({ next: () => finish(), error: finish }));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    void channel.requestExec(script).then(async () => {
      await inputReady;
      if(settled)return;
      if (options.input?.length) {
        if (!channel.write) throw new Error(t('当前 SSH 通道不支持标准输入写入'));
        for (let offset = 0; offset < options.input.length; offset += 32768) {
          if (settled) return;
          options.signal?.throwIfAborted();
          await channel.write(options.input.subarray(offset, offset + 32768));
        }
      }
      if (!settled) await channel.eof();
    }).catch(finish);
  });
}
