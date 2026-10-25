import { lstat, mkdir, open, readdir, unlink, link } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object, text } from './operations';

type Invoke = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
interface Endpoint { remote: boolean; path: string }
const endpoint = (input: unknown): Endpoint => {
  const value = text(input, 'copy path');
  const remote = value.startsWith('remote:');
  const path = remote ? value.slice(7) : value.startsWith('local:') ? value.slice(6) : value;
  if (!path || path.includes('\0')) throw new Error('Copy path must not be empty');
  return {remote, path: remote ? path : resolve(path)};
};

/** Streaming copy; only bounded chunks cross the authenticated bridge. */
export async function copy(args: Record<string, unknown>, invoke: Invoke): Promise<Record<string, unknown>> {
  const source = endpoint(args.source), target = endpoint(args.target);
  if (source.remote === target.remote) throw new Error('cp requires one local path and one remote:PATH');
  if (args.recursive !== undefined && typeof args.recursive !== 'boolean') throw new Error('recursive must be boolean');
  const control = (args: Record<string, unknown>) => invoke('remote_cp', args);
  const stat = async (entry: Endpoint): Promise<{exists: boolean; directory?: boolean}> => {
    if (entry.remote) return await control({action: 'stat', path: entry.path}) as {exists: boolean; directory?: boolean};
    const info = await lstat(entry.path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (info?.isSymbolicLink()) throw new Error('cp does not follow symbolic links');
    return {exists: !!info, directory: info?.isDirectory()};
  };
  const child = (entry: Endpoint, name: string): Endpoint => ({remote: entry.remote, path: entry.remote ? posix.join(entry.path, name) : join(entry.path, name)});
  const name = source.remote ? posix.basename(source.path) : basename(source.path);
  const destinationInfo = await stat(target);
  const destination = destinationInfo.directory ? child(target, name) : target;
  let files = 0, bytes = 0;
  const visit = async (from: Endpoint, to: Endpoint): Promise<void> => {
    const info = await stat(from);
    if (!info.exists) throw new Error('Copy source does not exist');
    if (info.directory && !args.recursive) throw new Error('Use cp -r to copy a directory');
    if ((await stat(to)).exists) throw new Error('Copy target already exists');
    if (info.directory) {
      if (to.remote) await control({action: 'mkdir', path: to.path});
      else await mkdir(to.path, {mode: 0o700});
      const names: string[] = [];
      if (from.remote) {
        let cursor: string | undefined;
        do {
          const page = await invoke('remote_list', {path: from.path, limit: 1000, ...(cursor ? {cursor} : {})});
          if (!Array.isArray(page.entries)) throw new Error('Invalid directory listing');
          for (const value of page.entries) {
            const entry = object(value), name = text(entry.name, 'name');
            if (entry.symlink) throw new Error('cp does not follow symbolic links');
            if (!name || ['.', '..'].includes(name) || /[\\/\x00]/.test(name)) throw new Error('Invalid copy entry name');
            names.push(name);
          }
          const next = page.nextCursor === undefined ? undefined : text(page.nextCursor, 'nextCursor');
          if (page.truncated && !next || next !== undefined && (!/^\d+$/.test(next) || Number(next) <= Number(cursor ?? 0))) throw new Error('Incomplete directory listing');
          cursor = next;
        } while (cursor);
      } else names.push(...await readdir(from.path));
      for (const name of names) await visit(child(from, name), child(to, name));
      return;
    }
    let transferId: string | undefined;
    if (to.remote) {
      const local = await open(from.path, 'r');
      try {
        const opened = await control({action: 'open-write', path: to.path});
        transferId = text(opened.transferId, 'transferId');
        const buffer = Buffer.alloc(256 * 1024);
        while (true) {
          const {bytesRead} = await local.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          await control({action: 'write', transferId, data: buffer.subarray(0, bytesRead).toString('base64')});
          bytes += bytesRead;
        }
        await control({action: 'close', transferId}); transferId = undefined;
      } finally {
        await local.close();
        if (transferId) await control({action: 'cancel', transferId}).catch(() => undefined);
      }
    } else {
      const temporary = join(dirname(to.path), '.arw-copy-' + randomUUID());
      const local = await open(temporary, 'wx', 0o600);
      try {
        const opened = await control({action: 'open-read', path: from.path});
        transferId = text(opened.transferId, 'transferId');
        while (true) {
          const result = await control({action: 'read', transferId});
          const data = text(result.data, 'data');
          if (data.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid copy chunk');
          const chunk = Buffer.from(data, 'base64');
          await local.writeFile(chunk); bytes += chunk.length;
          if (result.eof === true) { transferId = undefined; break; }
          if (!chunk.length) throw new Error('Copy transfer made no progress');
        }
        await local.close();
        // Publish without replacing an existing destination.
        await link(temporary, to.path);
      } finally {
        await local.close();
        await unlink(temporary).catch(() => undefined);
        if (transferId) await control({action: 'cancel', transferId}).catch(() => undefined);
      }
    }
    files++;
  };
  await visit(source, destination);
  return {copied: true, files, bytes};
}
