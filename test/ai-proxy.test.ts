import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiProxyEnvironment } from '../src/arw-ai-cli/proxy'

test('AI proxy is opt-in and bypasses local forwarding', () => {
    assert.deepEqual(aiProxyEnvironment(null), {})
    assert.deepEqual(aiProxyEnvironment(undefined), {})
    assert.deepEqual(aiProxyEnvironment(''), {})
    const env = aiProxyEnvironment(' http://127.0.0.1:7890 ')
    for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) {
        assert.equal(env[key], 'http://127.0.0.1:7890')
    }
    assert.equal(env.NO_PROXY,env.no_proxy)
    for (const host of ['localhost','127.0.0.1','::1']) assert.ok(env.NO_PROXY.split(',').includes(host))
    assert.equal(aiProxyEnvironment('https://proxy.example:8443').HTTPS_PROXY,'https://proxy.example:8443')
    for (const invalid of [7890,'7890','invalid','socks5://localhost:7890','http://localhost:65536','http://localhost/path']) {
        assert.throws(() => aiProxyEnvironment(invalid), /完整 HTTP/)
    }
})
