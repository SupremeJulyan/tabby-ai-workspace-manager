import { constants } from 'node:fs';
import { open, stat, mkdir, unlink, rename, chmod } from 'node:fs/promises';
import type { SFTPSession } from 'tabby-ssh/typings/session/sftp';

/** Uses real files behind the same handle interface as Tabby's SFTP wrapper. */
export const sftpFixture = () => ({
  async stat(path: string) { const info = await stat(path); return {isDirectory: info.isDirectory(), size: info.size, mode: info.mode, modified: info.mtime}; },
  async open(path: string, mode: number) {
    const flags=(mode&2?constants.O_WRONLY:constants.O_RDONLY)
      |(mode&8?constants.O_CREAT:0)|(mode&16?constants.O_TRUNC:0)|(mode&32?constants.O_EXCL:0);
    const file = await open(path, flags);
    return {
      async read() { const buffer = Buffer.alloc(256 * 1024); const {bytesRead} = await file.read(buffer); return buffer.subarray(0, bytesRead); },
      async write(chunk: Uint8Array) { await file.writeFile(chunk); },
      close: () => file.close(),
    };
  }, mkdir, unlink, rename, chmod,
}) as unknown as SFTPSession;
