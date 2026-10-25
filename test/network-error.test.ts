import assert from 'node:assert/strict'
import test from 'node:test'
import { describeNetworkError } from '../src/arw-cli/network-error'

test('network diagnostics report sandbox denial without leaking connection credentials', () => {
    const cause = Object.assign(new Error('http://127.0.0.1:1234/?token=secret'), {code: 'EPERM'})
    const text = describeNetworkError(new TypeError('fetch failed', {cause}))
    assert.match(text, /EPERM/)
    assert.match(text, /sandbox\/filesystem permissions/)
    assert.doesNotMatch(text, /secret|token=|1234/)
})

test('network diagnostics distinguish refused endpoints and inspect nested aggregate causes', () => {
    const cause = new AggregateError([Object.assign(new Error('private'), {code: 'ECONNREFUSED'})])
    const text = describeNetworkError(new TypeError('fetch failed', {cause}))
    assert.match(text, /ECONNREFUSED/)
    assert.match(text, /endpoint refused/)
    assert.doesNotMatch(text, /private/)
})

test('network diagnostics handle missing, unknown and cyclic causes safely', () => {
    const cause: {code: string; cause?: unknown} = {code: 'token=secret'}
    cause.cause = cause
    for (const error of [undefined, new TypeError('fetch failed'), cause]) {
        const text = describeNetworkError(error)
        assert.match(text, /does not by itself prove that SSH disconnected/)
        assert.doesNotMatch(text, /secret/)
    }
})


test('IPC diagnostics distinguish missing sockets and cancelled requests from SSH failures',()=>{
    const missing=describeNetworkError(Object.assign(new Error('/private/socket'),{code:'ENOENT'}))
    assert.match(missing,/ENOENT.*socket\/pipe was not found/)
    assert.doesNotMatch(missing,/private\/socket/)
    const cancelled=describeNetworkError(Object.assign(new Error('secret'),{code:'ABORT_ERR'}))
    assert.match(cancelled,/cancelled or timed out/)
    assert.match(cancelled,/Check remote state before retrying mutations/)
    assert.doesNotMatch(cancelled,/secret/)
})
