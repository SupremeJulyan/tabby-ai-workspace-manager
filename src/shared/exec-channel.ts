import { redactSensitiveText } from './redact'
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
  // SSH runs requestExec through the account's login shell, which may be tcsh/fish.
  // Keep its command line single-line and free of POSIX expansions. Decode only
  // inside /bin/sh; the inner shell protects the trailer from exit/exec/syntax errors.
  const body=`/bin/sh -c ${shellQuote(`cd -- ${shellQuote(cwd)} || exit $?\n${command}`)}\n`
    +`_arw_status=$?\nprintf '\\000${marker}:%s\\000' "$_arw_status"\nprintf '\\000${marker}:stderr\\000' >&2\nexit "$_arw_status"`;
  const encoded=body.replace(/[\\'!\x00-\x1f\x7f]/g,char=>`\\0${char.charCodeAt(0).toString(8).padStart(3,'0')}`);
  const script=`exec /bin/sh -c ${shellQuote('eval "$(printf "%b" "$1")"')} arw ${shellQuote(encoded)}`;
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, settled = false;
    let inputError:unknown;
    let drainTimer:ReturnType<typeof setTimeout>|undefined;
    let releaseInput!:()=>void;
    const inputReady=new Promise<void>(resolve=>{releaseInput=resolve});
    if(!options.inputReadyMarker)releaseInput();
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      releaseInput();
      clearTimeout(timer);
      clearTimeout(drainTimer);
      options.signal?.removeEventListener('abort', abort);
      subscriptions.forEach(subscription => subscription.unsubscribe());
      void channel.close().catch(() => undefined);
      if (error) { reject(error); return; }
      const output = Buffer.concat(stdout).toString('utf8');
      const errors=Buffer.concat(stderr).toString('utf8');
      const stderrMarker=`\0${marker}:stderr\0`;
      const match = new RegExp(`\\x00${marker}:(\\d{1,3})\\x00$`).exec(output);
      if (!match || Number(match[1]) > 255 || !errors.endsWith(stderrMarker)) {
        const errors=Buffer.concat(stderr);
        const diagnostic=redactSensitiveText(errors.toString('utf8').replace(stderrMarker,'')).trim().slice(0,1200);
        reject(new Error(`${t('SSH 命令未返回完整结果，执行状态未知，请检查远端。')} [stdout=${Buffer.concat(stdout).length} B, stderr=${errors.length} B]${diagnostic?`\n${diagnostic}`:''}`));
        return;
      }
      if(inputError&&Number(match[1])===0){reject(inputError);return;}
      resolve({ stdout: output.slice(0, match.index), stderr: errors.slice(0,-stderrMarker.length),
        exitCode: Number(match[1]) });
    };
    const abort = () => finish(new Error(t('操作已取消，远端命令状态需检查。')));
    const timer = setTimeout(() => finish(new Error(t('SSH 命令超时，执行状态未知，请检查远端。'))),
      options.timeoutMs ?? 600_000);
    let closed=false;
    const completed=()=>new RegExp(`\\x00${marker}:(\\d{1,3})\\x00$`).test(Buffer.concat(stdout).toString('utf8'))
      &&Buffer.concat(stderr).toString('utf8').endsWith(`\0${marker}:stderr\0`);
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
        if(closed&&completed())finish();
      }
    };
    subscriptions.push(channel.data$.subscribe({ next: value => append(stdout, value), error: finish }));
    subscriptions.push(channel.extendedData$.subscribe({ next: ([, value]) => append(stderr, value), error: finish }));
    // Native close/data callbacks may be reordered on Windows. Drain late data
    // while the adapter retains russh buffers; never resend the command.
    subscriptions.push(channel.closed$.subscribe({ next: () => {
      closed=true;
      if(completed()){finish();return;}
      if(!settled&&!drainTimer)drainTimer=setTimeout(()=>finish(),500);
    }, error: finish }));
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
    }).catch(error=>{
      // A rejecting remote writer may close stdin before its error/trailer arrives.
      // Drain that result; never accept a successful exit after a failed upload.
      if((error as NodeJS.ErrnoException)?.code==='EPIPE')inputError=error;
      else finish(error);
    });
  });
}
