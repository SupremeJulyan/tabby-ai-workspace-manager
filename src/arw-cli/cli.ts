#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readWorkspaceCatalog } from './workspace-catalog';
import { describeNetworkError } from './network-error';
import { ipcFetch, parseIpcConnection } from './ipc-client';
import { copy } from './transfers';
import { commands, help } from './commands';

declare const ARW_CLI_VERSION: string;

async function main(): Promise<void> {
  const stringOptions = ['id', 'workspace', 'input', 'file', 'content', 'path', 'query', 'name', 'output-id', 'stream', 'command', 'type', 'mode', 'limit', 'cursor', 'offset', 'length', 'head', 'tail', 'start-line', 'line-count'];
  const { values: parsedValues, positionals } = parseArgs({ allowPositionals: true, options: {
    ...Object.fromEntries(stringOptions.map(key => [key, { type: 'string' as const }])),
    version: { type: 'boolean', short: 'V' }, compact: { type: 'boolean' }, verbose: { type: 'boolean' },
    saved: { type: 'boolean' }, recursive: { type: 'boolean', short: 'r' }, help: { type: 'boolean', short: 'h' },
  } });
  const values: Record<string, string | boolean | undefined> = parsedValues;
  if (values.version) { console.log(`arw ${ARW_CLI_VERSION}`); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const [verb, ...positional] = positionals;
  const spec = Object.hasOwn(commands, verb) ? commands[verb] : undefined;
  if (!spec) throw new Error('Unsupported command; use --help');
  if (values.saved && verb !== 'workspaces') throw new Error('--saved requires workspaces');
  if (values.workspace && values.id) throw new Error('Choose --id or --workspace');
  values.id = values.id ?? values.workspace;
  if (verb !== 'workspaces' && !values.id) throw new Error('--id is required; run workspaces first');
  if (verb === 'workspaces' && values.id) throw new Error('workspaces does not accept --id');
  if (values.file !== undefined && !['write', 'create'].includes(verb)) throw new Error('--file requires write or create');
  if (values.file === '-' && values.input === '-') throw new Error('--file and --input cannot both read stdin');
  let stdin = '';
  if (values.file === '-' || values.input === '-') {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) stdin += chunk;
  }
  let args: Record<string, unknown> = values.input === undefined ? {} : JSON.parse(values.input === '-' ? stdin : String(values.input));
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('--input must be a JSON object');
  const assign = (key: string, value: unknown) => {
    if (!spec.fields.includes(key)) throw new Error(`Unsupported argument for ${verb}: ${key}`);
    if (Object.hasOwn(args, key)) throw new Error(`Duplicate argument: ${key}`);
    args[key] = value;
  };
  for (const key of Object.keys(args)) if (!spec.fields.includes(key)) throw new Error(`Unsupported input field: ${key}`);
  positional.forEach((value, index) => {
    const key = spec.positional?.[index];
    if (!key) throw new Error('Too many arguments; quote the command as one argument');
    assign(key, value);
  });
  for (const key of stringOptions.filter(key => !['id', 'workspace', 'input', 'file'].includes(key))) {
    if (values[key] === undefined) continue;
    const numeric = ['limit', 'offset', 'length', 'head', 'tail', 'start-line', 'line-count'].includes(key);
    if (numeric && (!/^\d+$/.test(String(values[key])) || !Number.isSafeInteger(Number(values[key])))) throw new Error(`Invalid --${key}`);
    if (key === 'name' && ['search', 'find'].includes(verb)) { assign('query', values[key]); if (args.mode !== undefined && args.mode !== 'names') throw new Error('--name requires mode names'); args.mode = 'names'; }
    else assign(key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), numeric ? Number(values[key]) : values[key]);
  }
  if (values.file !== undefined) assign('content', values.file === '-' ? stdin : await readFile(String(values.file), 'utf8'));
  if (verb === 'find') args.mode = 'names';
  if (verb !== 'workspaces') args.workspaceId = values.id;
  if (values.recursive) assign('recursive', true);
  const catalog=await readWorkspaceCatalog();
  if(verb==='workspaces'){console.log(JSON.stringify(catalog));return;}
  const workspace=catalog.workspaces.find(entry=>entry.workspaceId===values.id);
  if(!workspace)throw new Error('Workspace is unavailable; run arw workspaces again');
  if(!workspace.configPath||workspace.status!=='forwarded')throw new Error('Workspace is not connected; open its terminal connection in Tabby');
  const configPath=workspace.configPath;
  const config = parseIpcConnection(JSON.parse(await readFile(configPath, 'utf8')));
  const invoke = async (name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await ipcFetch(config, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: {...arguments_, workspaceId: values.id} }), signal: AbortSignal.timeout(600_000) })
      .catch((error: unknown) => { throw new Error(describeNetworkError(error)); });
    const envelope = await response.json() as { result?: Record<string, unknown>; error?: string };
    if (!response.ok || !envelope.result) throw new Error(envelope.error ?? `CLI HTTP ${response.status}`);
    if (envelope.result.status === 'error' || envelope.result.code) throw new Error(String(envelope.result.message ?? envelope.result.code));
    return envelope.result;
  };
  const result = verb === 'cp' ? await copy(args, invoke) : await invoke(spec.tool, args);
  if (verb === 'exec' && !values.verbose) {
    if (result.truncated) process.stderr.write(JSON.stringify({outputId: result.outputId, nextOffsets: result.nextOffsets, truncated: true}) + '\n');
    process.stdout.write(String(result.stdout ?? '')); process.stderr.write(String(result.stderr ?? ''));
    process.exitCode = typeof result.exitCode === 'number' && result.exitCode >= 0 && result.exitCode <= 255 ? result.exitCode : 1;
  } else {
    const output = result;
    const compact = (value: unknown): unknown => Array.isArray(value) ? value.map(compact)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, value]) => !(key === 'status' && value === 'ok' || key === 'ok' && value === true || ['truncated', 'hasMore'].includes(key) && value === false)).map(([key, value]) => [key, compact(value)])) : value;
    console.log(JSON.stringify(values.compact ? compact(output) : output));
    if (verb === 'exec') process.exitCode = typeof result.exitCode === 'number' && result.exitCode >= 0 && result.exitCode <= 255 ? result.exitCode : 1;
    if (Array.isArray(result.results) && result.results.some((entry: any) => entry.ok === false)) process.exitCode = 1;
  }
}
main().catch(error => { console.error(`ARW: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
