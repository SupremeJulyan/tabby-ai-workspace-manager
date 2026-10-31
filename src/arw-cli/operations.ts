import { textFileLimit } from '../shared/text-file-limit'
import { randomUUID } from 'node:crypto';
import { RemotePathGuard } from '../security/remote-path';
import { shellQuote } from '../shared/shell-quote';
import type { ForwardingBackend } from './forwarding-server';

export function integer(value: unknown, fallback: number, min = 0, max = 10 * 1024 * 1024): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected integer between ${min} and ${max}`);
  return value;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function selectText(content: string, args: Record<string, unknown>) {
  const groups = [args.offset !== undefined || args.length !== undefined, args.head !== undefined, args.tail !== undefined, args.startLine !== undefined || args.lineCount !== undefined].filter(Boolean).length;
  if (groups > 1) throw new Error('Choose byte offsets, head, tail, or line selection');
  const bytes = Buffer.from(content);
  if (args.offset !== undefined || args.length !== undefined) {
    const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER), length = integer(args.length, 65536);
    // Round byte boundaries inward rather than returning broken UTF-8 characters.
    let start = Math.min(offset, bytes.length), end = Math.min(offset + length, bytes.length);
    while (start < end && (bytes[start] & 0xc0) === 0x80) start++;
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === start && length > 0 && start < bytes.length) { end = start + 1; while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++; }
    return { content: bytes.subarray(start, end).toString('utf8'), offset: start, nextOffset: end, totalBytes: bytes.length, truncated: end < bytes.length };
  }
  if (!groups) return { content };
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const start = args.tail !== undefined ? Math.max(0, lines.length - integer(args.tail, 0)) : args.head !== undefined ? 0 : integer(args.startLine, 1, 1) - 1;
  const count = args.head !== undefined ? integer(args.head, 0) : args.tail !== undefined ? integer(args.tail, 0) : integer(args.lineCount, 200);
  return { content: lines.slice(start, start + count).join(''), startLine: start + 1, totalLines: lines.length, truncated: start + count < lines.length };
}

export async function fileOperation(backend: ForwardingBackend, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const run = async (command: string) => {
    signal.throwIfAborted();
    const result = object(await backend.run(command, signal));
    if (result.exitCode !== 0) throw new Error(String(result.stderr || 'Remote file operation failed'));
    return result;
  };
  const guard = new RemotePathGuard(backend.workspace.root, async (command, currentSignal) => object(await backend.run(command, currentSignal ?? signal)) as unknown as {stdout: string; stderr: string; exitCode: number});
  const path = () => text(args.path, 'path');
  const mutable = async (input: string, missing = false) => {
    const target = await guard.resolve(input, true, signal);
    if (!missing) await guard.resolve(input, false, signal);
    const root = await guard.resolve('.', false, signal);
    if (target === root) throw new Error('Cannot mutate workspaceRoot');
    return shellQuote(target);
  };
  switch (name) {
    case 'remote_read': {
      const result = object(await backend.read(path(), signal));
      return { path: path(), ...result, ...selectText(text(result.content, 'content'), args) };
    }
    case 'remote_list': {
      const result = object(await backend.list(text(args.path ?? '.', 'path'), signal));
      if (!Array.isArray(result.entries)) throw new Error('Invalid directory response');
      if (args.cursor !== undefined && !/^\d+$/.test(text(args.cursor, 'cursor'))) throw new Error('Invalid cursor');
      const offset = args.cursor === undefined ? 0 : integer(Number(text(args.cursor, 'cursor')), 0);
      const limit = integer(args.limit, 1000, 1, 1000);
      const end = offset + limit;
      return { ...result, entries: result.entries.slice(offset, end), truncated: result.truncated === true || end < result.entries.length,
        ...(end < result.entries.length ? { nextCursor: String(end) } : {}) };
    }
    case 'remote_write': {
      const input = path(), content = text(args.content, 'content');
      return backend.write(input, content, signal, args.expectedHash === undefined ? undefined : text(args.expectedHash, 'expectedHash'));
    }
    case 'remote_edit': {
      const input = path(), original = object(await backend.read(input, signal));
      if (args.expectedHash !== undefined && args.expectedHash !== original.hash) throw new Error('File changed; read it again before editing');
      if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 100) throw new Error('edits must contain 1 to 100 replacements');
      let content = text(original.content, 'content');
      for (const value of args.edits) {
        const edit = object(value);
        if (Object.keys(edit).some(key => !['oldText', 'newText'].includes(key))) throw new Error('Unsupported edit field');
        const old = text(edit.oldText, 'oldText'), replacement = text(edit.newText, 'newText');
        const index = content.indexOf(old);
        if (!old || index < 0 || content.indexOf(old, index + 1) >= 0) throw new Error('oldText must match exactly once');
        content = content.slice(0, index) + replacement + content.slice(index + old.length);
      }
      if (typeof original.hash !== 'string') throw new Error('Backend does not support conflict-safe edits');
      return backend.write(input, content, signal, original.hash);
    }
    case 'remote_create': {
      const target = await mutable(path(), true);
      if (args.type === 'directory') {
        if (args.content !== undefined) throw new Error('Directories cannot have content');
        await run(`mkdir -- ${target}`);
      } else if (args.type === 'file') {
        const content = text(args.content ?? '', 'content');
        if (Buffer.byteLength(content) > textFileLimit) throw new Error('Text files are limited to 500 MiB');
        const temporary = shellQuote((await guard.resolve(path(), true, signal)) + '.arw-' + randomUUID() + '.tmp');
        let created = false;
        try {
          await run(`(umask 077; set -C; : > ${temporary})`); created = true;
          const data = Buffer.from(content).toString('base64');
          for (let offset = 0; offset < data.length; offset += 32768) await run(`printf '%s' ${shellQuote(data.slice(offset, offset + 32768))} | base64 -d >> ${temporary}`);
          if (shellQuote(await guard.resolve(path(), true, signal)) !== target) throw new Error('Remote path changed');
          await run(`if test -e ${target} || test -L ${target}; then exit 1; fi; mv -nT -- ${temporary} ${target}; test ! -e ${temporary}`);
        } finally { if (created) await run(`rm -f -- ${temporary}`).catch(() => undefined); }
      } else throw new Error('type must be file or directory');
      return { path: path(), created: true };
    }
    case 'remote_delete': {
      if (args.recursive !== undefined && typeof args.recursive !== 'boolean') throw new Error('recursive must be boolean');
      const target = await mutable(path());
      await run(args.recursive ? `rm -r -- ${target}` : `if test -d ${target}; then rmdir -- ${target}; else rm -- ${target}; fi`);
      return { deleted: true, path: path() };
    }
    case 'remote_chmod': {
      const mode = text(args.mode, 'mode');
      if (!/^[0-7]{3}$/.test(mode)) throw new Error('mode must be three octal digits');
      await run(`chmod ${mode} -- ${await mutable(path())}`);
      return { path: path(), mode };
    }
    case 'remote_move': {
      if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') throw new Error('overwrite must be boolean');
      const source = await mutable(text(args.sourcePath, 'sourcePath'));
      const target = await mutable(text(args.targetPath, 'targetPath'), true);
      // -T prevents accidentally moving into an existing directory; -n preserves existing files.
      await run(args.overwrite ? `mv -fT -- ${source} ${target}` : `if test -e ${target} || test -L ${target}; then exit 1; fi; mv -nT -- ${source} ${target}; test ! -e ${source}`);
      return { moved: true };
    }
    case 'remote_search': {
      const query = text(args.query, 'query'), mode = text(args.mode ?? 'content', 'mode');
      if (!['content', 'files', 'count', 'names'].includes(mode)) throw new Error('mode must be content, files, count, or names');
      for (const key of ['ignoreCase', 'fixedStrings']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be boolean`);
      const glob = (pattern: string) => new RegExp('^' + pattern.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', args.ignoreCase ? 'i' : '');
      const matcher = mode === 'names' ? glob(query) : args.fixedStrings ? undefined : new RegExp(query, args.ignoreCase ? 'i' : '');
      const limit = integer(args.limit, 100, 1, 1000);
      const excluded = args.excludeDirs === undefined ? ['.git', 'node_modules'] : args.excludeDirs;
      if (!Array.isArray(excluded) || excluded.some(value => typeof value !== 'string')) throw new Error('excludeDirs must be a string array');
      const include = args.include === undefined ? undefined : glob(text(args.include, 'include'));
      const queue = [text(args.path ?? '.', 'path')], results: unknown[] = [];
      let visited = 0, scannedBytes = 0, skippedFiles = 0, truncated = false;
      while (queue.length && results.length < limit) {
        signal.throwIfAborted();
        const listing = object(await backend.list(queue.shift()!, signal));
        if (listing.truncated) truncated = true;
        if (!Array.isArray(listing.entries)) throw new Error('Invalid directory response');
        for (const value of listing.entries) {
          signal.throwIfAborted();
          if (++visited > 10000) { truncated = true; break; }
          const entry = object(value);
          if (entry.symlink) continue;
          const input = text(entry.path, 'entry.path'), basename = text(entry.name, 'entry.name');
          if (entry.directory) { if (!excluded.includes(basename)) queue.push(input); continue; }
          if (include && !include.test(basename)) continue;
          if (mode === 'names') { if (matcher!.test(basename)) results.push({ path: input }); }
          else {
            let file: Record<string, unknown>;
            try { file = object(await backend.read(input, signal)); }
            catch (error) {
              if (/binary|UTF-8|encoded data|too large|limited to|上限|二进制/i.test(String(error))) { skippedFiles++; continue; }
              throw error;
            }
            const content = text(file.content, 'content');
            scannedBytes += Buffer.byteLength(content);
            if (scannedBytes > 8 * 1024 * 1024) { truncated = true; break; }
            const matches: {line: number; text: string}[] = [];
            for (const [index, line] of content.split('\n').entries()) {
              const matched = matcher ? matcher.test(line) : (args.ignoreCase ? line.toLowerCase().includes(query.toLowerCase()) : line.includes(query));
              if (matched) {
                if (mode === 'files') { matches.push({line: index + 1, text: ''}); break; }
                matches.push({line: index + 1, text: line});
                if (mode === 'content' && results.length + matches.length >= limit) break;
              }
            }
            if (mode === 'content') results.push(...matches.map(match => ({path: input, ...match})));
            else if (matches.length) results.push({path: input, ...(mode === 'count' ? {count: matches.length} : {})});
          }
          if (results.length >= limit) { truncated = true; break; }
        }
        if (visited > 10000 || scannedBytes > 8 * 1024 * 1024) break;
      }
      return { results: results.slice(0, limit), truncated: truncated || queue.length > 0, skippedFiles };
    }
    default: throw new Error('Unsupported CLI operation');
  }
}
