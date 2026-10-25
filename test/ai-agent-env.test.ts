import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentEnvironment, parseAgentEnvironment } from '../src/arw-ai-cli/agent-env'

test('AI environment variables read private key files and values', () => {
    const home = mkdtempSync(join(tmpdir(), 'arw-env-'))
    try {
        writeFileSync(join(home, 'key'), 'secret\n')
        chmodSync(join(home, 'key'), 0o600)
        assert.deepEqual(agentEnvironment([
            { name: 'OPENAI_API_KEY', file: 'key' },
            { name: 'CUSTOM', value: 'value' },
        ], home), { OPENAI_API_KEY: 'secret', CUSTOM: 'value' })
        chmodSync(join(home, 'key'), 0o644)
        assert.throws(() => agentEnvironment([{ name: 'OPENAI_API_KEY', file: 'key' }], home), /权限过宽/)
    } finally {
        rmSync(home, { recursive: true, force: true })
    }
})

test('AI environment variables reject invalid or duplicate names', () => {
    assert.deepEqual(agentEnvironment(undefined), {})
    assert.throws(() => agentEnvironment([{ name: 'BAD-NAME', value: 'x' }]), /名称无效/)
    assert.throws(() => agentEnvironment([{ name: 'A', value: 'x' }, { name: 'A', value: 'y' }]), /重复/)
    assert.throws(() => agentEnvironment([{ name: 'A', value: 'x', file: 'key' }]), /不能同时/)
})

test('AI environment variables use one space-separated pair per line', () => {
    assert.deepEqual(parseAgentEnvironment('OPENAI_API_KEY sk_test\nCUSTOM value with spaces\n\n'), [
        { name: 'OPENAI_API_KEY', value: 'sk_test' },
        { name: 'CUSTOM', value: 'value with spaces' },
    ])
    assert.deepEqual(parseAgentEnvironment(''), [])
    assert.throws(() => parseAgentEnvironment('OPENAI_API_KEY'), /缺少值/)
    assert.throws(() => parseAgentEnvironment('OPENAI_API_KEY=sk_test'), /名称无效/)
    assert.throws(() => parseAgentEnvironment('OPENAI_API_KEY ***'), /重新输入/)
    assert.throws(() => parseAgentEnvironment('OPENAI_API_KEY  '), /缺少值/)
    assert.throws(() => parseAgentEnvironment('BAD-NAME value'), /名称无效/)
    assert.throws(() => parseAgentEnvironment('A x\nA y'), /重复/)
})
