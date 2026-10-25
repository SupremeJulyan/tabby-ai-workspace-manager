export function describeNetworkError (error: unknown): string {
    const codes = new Set<string>()
    const visited = new Set<object>()
    const inspect = (value: unknown, depth: number): void => {
        if (!value || typeof value !== 'object' || visited.has(value) || depth > 8) return
        visited.add(value)
        const detail = value as {code?: unknown; cause?: unknown; errors?: unknown}
        if (typeof detail.code === 'string' && /^(?:ABORT_ERR|ENOENT|EACCES|EPERM|ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(detail.code)) codes.add(detail.code)
        inspect(detail.cause, depth + 1)
        if (Array.isArray(detail.errors)) for (const nested of detail.errors.slice(0, 16)) inspect(nested, depth + 1)
    }
    inspect(error, 0)
    const codeText = codes.size ? ` (${[...codes].join(', ')})` : ''
    const hint = codes.has('EPERM') || codes.has('EACCES')
        ? 'Local IPC access was denied. Check the AI command sandbox/filesystem permissions; request approval through its supported mechanism if available. Do not disable security automatically.'
        : codes.has('ABORT_ERR') ? 'The IPC request was cancelled or timed out. Check remote state before retrying mutations.'
        : codes.has('ENOENT') ? 'The local IPC socket/pipe was not found. Refresh arw workspaces and check that Tabby is running; an isolated filesystem may hide the socket.'
        : codes.has('ECONNREFUSED')
            ? 'The local forwarding endpoint refused the connection. Refresh arw workspaces and check that Tabby is running; an isolated AI filesystem may also hide the socket.'
            : 'Check local socket/pipe access from the AI command environment and the current forwarding endpoint.'
    return `IPC request failed${codeText}: ${hint} This does not by itself prove that SSH disconnected. Catalog status forwarded is not a live connectivity check.`
}
