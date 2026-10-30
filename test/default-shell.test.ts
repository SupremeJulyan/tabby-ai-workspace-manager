import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultShell } from '../src/arw-ai-cli/default-shell'

test('launch follows the current Tabby default without persisting a shell', () => {
    const shells = [{ id: 'local:default' }, { id: 'local:zsh' }]
    assert.equal(defaultShell(shells, 'local:zsh'), shells[1])
    assert.equal(defaultShell(shells, 'local:default'), shells[0])
    assert.equal(defaultShell(shells, undefined), shells[0])
    assert.equal(defaultShell(shells, 'removed-profile'), shells[0])
    assert.deepEqual(shells, [{ id: 'local:default' }, { id: 'local:zsh' }])
    assert.equal(defaultShell([], 'local:default'), undefined)
    assert.equal(defaultShell([{ id: 'ssh:remote' }], undefined), undefined)
})
