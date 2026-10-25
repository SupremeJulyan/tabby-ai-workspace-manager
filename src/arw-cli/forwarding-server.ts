import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { NAMED_PIPE_PREFIX, type IpcConnection } from './ipc-client';
import { redactSensitiveText } from '../shared/redact';
import { assertCommandAllowed, CommandPolicyError } from '../security/command-policy';
import { appendAudit, AuditEntry } from '../security/audit';
import { workspaceCatalogPath } from './workspace-catalog';
import { RemotePathError } from '../security/remote-path';
import { commands } from './commands';
import { fileOperation, integer, object, text, selectText } from './operations';
import { agentActivity } from './agent-activity';

export interface ForwardingBackend {
  activityScope?: string;
  workspace: { id: string; root: string; host: string };
  list(path: string, signal: AbortSignal): Promise<unknown>;
  read(path: string, signal: AbortSignal): Promise<unknown>;
  write(path: string, content: string, signal: AbortSignal, expectedHash?: string): Promise<unknown>;
  run(command: string, signal: AbortSignal, options?: {maxBytes?: number}): Promise<unknown>;
  terminalOnly?():boolean;
  currentFile?(): unknown;
  onRequestFinished?(operation:string,error?:unknown):void;
  copy?(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  validateCommand?(command: string, signal: AbortSignal): Promise<void>;
}

/** Authenticated local CLI bridge. No MCP protocol. */
export class ForwardingServer {
  private server?: Server;
  private outputs = new Map<string, Record<string, unknown>>();
  private controller = new AbortController();
  private token = randomBytes(32).toString('hex');
  private endpoint?: IpcConnection;
  private socketDirectory?: string;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  constructor(private backend: ForwardingBackend,
    private auditFile = join(dirname(workspaceCatalogPath()), 'audit.jsonl')) {}
  get connection(): IpcConnection { if (!this.endpoint) throw new Error('Forwarding is not enabled'); return {...this.endpoint}; }

  start(): Promise<void> {
    if(this.stopping)return this.stopping.then(()=>this.start());
    if(this.server)return Promise.resolve();
    return this.starting??=(this.listen().finally(()=>{this.starting=undefined}));
  }

  private async listen(): Promise<void> {
    this.token=randomBytes(32).toString('hex');
    const server = createServer(async (request, response) => {
      const reply = (status: number, value: unknown) => {
        if (response.destroyed) return;
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (this.controller.signal.aborted) { reply(503, { error: 'Forwarding disabled' }); return; }
      if (request.headers.host !== 'arw.local' || request.headers.origin!==undefined) {
        reply(403, { error: 'Host or origin not allowed' }); return;
      }
      if (request.url !== '/cli' || request.headers.authorization !== `Bearer ${this.token}`) {
        reply(401, { error: 'Unauthorized' }); return;
      }
      if (request.method !== 'POST') { reply(405, { error: 'Method not allowed' }); return; }
      let input: { name?: unknown; arguments?: unknown };
      try {
        const chunks: Buffer[] = []; let length = 0;
        for await (const value of request) {
          length += value.length;
          if (length > 2 * 1024 * 1024) { reply(413, { error: 'Request too large' }); return; }
          chunks.push(Buffer.from(value));
        }
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      } catch { reply(400, { error: 'Invalid JSON request' }); return; }
      try {
        const result = await this.invoke(input);
        this.controller.signal.throwIfAborted();
        reply(200, { result });
      } catch (error) {
        reply(200, { result: { status: 'error', code: error instanceof CommandPolicyError || error instanceof RemotePathError ? 'POLICY_DENIED' : 'REMOTE_TOOL_ERROR',
          message: redactSensitiveText(error instanceof Error ? error.message : String(error)) } });
      }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    this.controller = new AbortController();
    let socketPath: string;
    try {
      if(process.platform==='win32')socketPath=NAMED_PIPE_PREFIX+randomUUID();
      else {
        const base=Buffer.byteLength(join(tmpdir(),'arw-XXXXXX','cli.sock'))<=100?tmpdir():'/tmp';
        this.socketDirectory=await mkdtemp(join(base,'arw-'));
        await chmod(this.socketDirectory,0o700);
        socketPath=join(this.socketDirectory,'cli.sock');
      }
      await new Promise<void>((resolve,reject)=>{
        server.once('error',reject);
        server.listen({path:socketPath,readableAll:false,writableAll:false},()=>{server.off('error',reject);resolve()});
      });
      if(process.platform!=='win32')await chmod(socketPath,0o600);
      this.server=server;
      this.endpoint={version:2,socketPath,token:this.token};
    }catch(error){
      server.closeAllConnections();
      if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
      if(this.socketDirectory)await rm(this.socketDirectory,{recursive:true,force:true});
      this.socketDirectory=undefined;
      throw error;
    }
  }

  private async invoke(input: { name?: unknown; arguments?: unknown }): Promise<unknown> {
    const activityId = agentActivity.start(this.backend.workspace, input, this.backend.activityScope);
    try {
      const result = await this.invokeAudited(input);
      this.reportRequest(input.name);
      agentActivity.finish(activityId, result);
      return result;
    } catch (error) {
      if(!(error instanceof CommandPolicyError)&&!(error instanceof RemotePathError))this.reportRequest(input.name,error);
      agentActivity.finish(activityId, undefined, error, error instanceof CommandPolicyError || error instanceof RemotePathError);
      throw error;
    }
  }

  private reportRequest(operation:unknown,error?:unknown):void {
    if(typeof operation!=='string'||['list_remote_workspaces','current_remote_file','remote_output','arw_cli_batch'].includes(operation))return;
    try{this.backend.onRequestFinished?.(operation,error)}catch{/* Status rendering must not change request results. */}
  }

  private async invokeAudited(input: { name?: unknown; arguments?: unknown }): Promise<unknown> {
    const args = input.arguments as Record<string, unknown> | undefined;
    const entry: AuditEntry = { workspaceId: this.backend.workspace.id,
      operation: typeof input.name === 'string' && Object.values(commands).some(command => command.tool === input.name) ? input.name : 'invalid',
      outcome: 'requested', requestId: randomUUID(),
      command: typeof args?.command === 'string' ? args.command : undefined,
      path: typeof args?.path === 'string' ? args.path : undefined };
    await appendAudit(this.auditFile, entry);
    let result: unknown;
    try {
      result = await this.invokeValidated(input);
    } catch (error) {
      try {
        await appendAudit(this.auditFile, {...entry, outcome: error instanceof CommandPolicyError || error instanceof RemotePathError ? 'denied' : 'failed'});
      } catch { throw new Error('Request failed and its final audit record could not be written. Check state before retrying mutations.'); }
      throw error;
    }
    try { await appendAudit(this.auditFile, {...entry, outcome: 'completed'}); }
    catch { throw new Error('Operation may have completed but its final audit record could not be written. Do not automatically retry mutations.'); }
    return result;
  }

  private async invokeValidated(input: { name?: unknown; arguments?: unknown }): Promise<unknown> {
    this.controller.signal.throwIfAborted();
    const workspace = this.backend.workspace;
    if (input.name === 'list_remote_workspaces') return { workspaces: [{
      workspaceId: workspace.id, workspaceRoot: workspace.root, host: workspace.host,
    }] };
    const args = input.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
    const values = args as Record<string, unknown>;
    if (values.workspaceId !== workspace.id) throw new Error('Workspace is unavailable; run arw workspaces again');
    if(this.backend.terminalOnly?.()&&!['run_remote_command','remote_output'].includes(String(input.name)))throw new CommandPolicyError('Terminal mode only supports arw exec; file, search, transfer and batch operations are disabled');
    const spec = Object.values(commands).find(command => command.tool === input.name);
    if (!spec) throw new Error('Unsupported CLI operation');
    const fields = input.name === 'remote_cp' ? ['action', 'path', 'transferId', 'data'] : spec.fields;
    if (Object.keys(values).some(key => key !== 'workspaceId' && !fields.includes(key))) throw new Error('Unsupported argument for this CLI operation');
    const signal = this.controller.signal;
    switch (input.name) {
      case 'remote_cp': {
        if (!this.backend.copy) throw new Error('SFTP copy is unavailable for this workspace');
        return this.backend.copy(values, signal);
      }
      case 'current_remote_file': return {file: this.backend.currentFile?.() ?? null};
      case 'remote_output': {
        const output = this.outputs.get(text(values.outputId, 'outputId'));
        if (!output) throw new Error('Output expired or unavailable in this workspace');
        const stream = text(values.stream, 'stream');
        if (!['stdout', 'stderr'].includes(stream)) throw new Error('stream must be stdout or stderr');
        return {outputId: values.outputId, stream, ...selectText(String(output[stream] ?? ''), {offset: integer(values.offset, 0, 0, Number.MAX_SAFE_INTEGER), length: integer(values.length, 65536)})};
      }
      case 'arw_cli_batch': {
        if (!Array.isArray(values.operations) || !values.operations.length || values.operations.length > 50) throw new Error('batch requires 1 to 50 operations');
        // Validate the whole envelope before starting any mutation.
        const operations = values.operations.map(value => {
          const operation = object(value), verb = text(operation.command, 'command');
          const command = Object.hasOwn(commands, verb) ? commands[verb] : undefined;
          if (!command || ['arw_cli_batch', 'list_remote_workspaces', 'remote_cp'].includes(command.tool)) throw new Error('Unsupported batch command');
          if (Object.keys(operation).some(key => !['command', 'arguments'].includes(key))) throw new Error('Unsupported batch field');
          const args = object(operation.arguments ?? {});
          if (Object.keys(args).some(key => !command.fields.includes(key))) throw new Error('Unsupported batch argument');
          return { name: command.tool, arguments: { ...args, ...(operation.command === 'find' ? {mode: 'names'} : {}), workspaceId: workspace.id } };
        });
        const results: unknown[] = [];
        for (const [index, operation] of operations.entries()) {
          try {
            const result = await this.invoke(operation);
            const value = object(result);
            const ok = value.status !== 'error' && (value.exitCode === undefined || value.exitCode === 0);
            results.push({index, ok, result});
            if (!ok) break;
          } catch (error) {
            results.push({index, ok: false, result: {status: 'error', message: redactSensitiveText(error instanceof Error ? error.message : String(error))}});
            break;
          }
        }
        return { results, completed: results.length, total: operations.length };
      }
      case 'remote_read_many': {
        if (!Array.isArray(values.requests) || !values.requests.length || values.requests.length > 50) throw new Error('requests must contain 1 to 50 reads');
        let remaining = integer(values.maxBytes, 65536, 1);
        const results: unknown[] = [];
        for (const request of values.requests) {
          const args = object(request);
          if (Object.keys(args).some(key => !commands.read.fields.includes(key))) throw new Error('Unsupported read argument');
          const result = object(await fileOperation(this.backend, 'remote_read', args, signal));
          const content = text(result.content, 'content');
          const bytes = Buffer.byteLength(content);
          if (bytes > remaining) { results.push({path: args.path, skipped: true, reason: 'maxBytes exceeded'}); break; }
          results.push(result); remaining -= bytes;
        }
        return {results, truncated: results.length < values.requests.length || results.some(value => object(value).skipped)};
      }
      case 'run_remote_command': {
        const command = text(values.command, 'command');
        assertCommandAllowed(command, workspace.root);
        await this.backend.validateCommand?.(command, signal);
        const result = object(await this.backend.run(command, signal, {maxBytes: 8 * 1024 * 1024}));
        signal.throwIfAborted();
        if (Buffer.byteLength(String(result.stdout ?? '')) + Buffer.byteLength(String(result.stderr ?? '')) <= 65536) return result;
        const outputId = randomUUID();
        if (this.outputs.size >= 4) this.outputs.delete(this.outputs.keys().next().value!);
        this.outputs.set(outputId, result);
        const stdout = selectText(String(result.stdout ?? ''), {offset: 0, length: 32768});
        const stderr = selectText(String(result.stderr ?? ''), {offset: 0, length: 32768});
        return {...result, stdout: stdout.content, stderr: stderr.content, truncated: true, outputId,
          nextOffsets: {stdout: stdout.nextOffset, stderr: stderr.nextOffset}};
      }
      default: return fileOperation(this.backend, String(input.name), values, signal);
    }
  }

  stop(): Promise<void> {
    return this.stopping??=(this.shutdown().finally(()=>{this.stopping=undefined}));
  }

  private async shutdown(): Promise<void> {
    await this.starting?.catch(()=>undefined);
    this.controller.abort();
    this.outputs.clear();
    const server = this.server;
    this.server = undefined;
    this.endpoint = undefined;
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    const directory=this.socketDirectory;this.socketDirectory=undefined;
    if(directory)await rm(directory,{recursive:true,force:true});
  }
}
