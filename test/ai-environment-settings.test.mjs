import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('AI environment overrides are absent from settings, defaults, and launcher', () => {
    const settings = readFileSync('src/arw-ai-cli/settings.component.ts', 'utf8')
    const launcher = readFileSync('src/arw-ai-cli/launcher.service.ts', 'utf8')
    const config = readFileSync('src/config.ts', 'utf8')
    assert.doesNotMatch(settings, /arw-env|environmentText|agent\.env/)
    assert.doesNotMatch(launcher, /agentEnvironment|configured\?\.env|customEnv/)
    assert.doesNotMatch(config, /env: \[\]/)
    assert.match(settings, /arw-proxy-url/)
    assert.match(launcher, /aiProxyEnvironment/)
})
