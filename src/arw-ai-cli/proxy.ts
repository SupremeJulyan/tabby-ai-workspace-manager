import { t } from '../shared/i18n'
export function aiProxyEnvironment (address: unknown): Record<string,string> {
    if (address === undefined || address === null || address === '') return {}
    const message = t('请输入完整 HTTP/HTTPS 代理地址，例如 http://127.0.0.1:7897，或留空')
    if (typeof address !== 'string') throw new Error(message)
    const url = address.trim()
    if (!url) return {}
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error(message) }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(message)
    const bypass = [...new Set(['localhost', '127.0.0.1', '::1',
        ...(process.env.NO_PROXY ?? '').split(','), ...(process.env.no_proxy ?? '').split(',')].map(host => host.trim()).filter(Boolean))].join(',')
    return { HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url,
        http_proxy: url, https_proxy: url, all_proxy: url, NO_PROXY: bypass, no_proxy: bypass }
}
