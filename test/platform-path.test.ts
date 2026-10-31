import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspacePath, parentWorkspacePath } from '../src/shared/workspace-path'
import { relativePreviewAsset } from '../src/arw-tree/preview/model'

test('Windows local paths support deep parents, drive roots, UNC and mixed separators',()=>{
    assert.equal(parentWorkspacePath('a\\b','local','win32'),'a')
    assert.equal(parentWorkspacePath('a/b','local','win32'),'a')
    assert.equal(parentWorkspacePath('a','local','win32'),'')
    assert.equal(parentWorkspacePath('C:\\a','local','win32'),'C:\\')
    assert.equal(parentWorkspacePath('\\\\server\\share\\a','local','win32'),'\\\\server\\share\\')
    assert.equal(workspacePath('local','win32').join('C:\\root','a\\b'),'C:\\root\\a\\b')
})

test('remote paths stay POSIX on Windows and preserve literal backslashes in remote filenames',()=>{
    assert.equal(parentWorkspacePath('a/b','remote','win32'),'a')
    assert.equal(parentWorkspacePath('a\\b','remote','win32'),'')
    assert.equal(relativePreviewAsset('dir/README.md','image.png','remote','win32'),'dir/image.png')
    assert.equal(relativePreviewAsset('dir\\literal/README.md','image.png','remote','win32'),'dir\\literal/image.png')
})

test('nested Markdown assets and image groups use the local filesystem path rules',()=>{
    assert.equal(relativePreviewAsset('nested\\README.md','img.png','local','win32'),'nested\\img.png')
    assert.equal(relativePreviewAsset('nested\\deep\\README.md','../image%20name.png','local','win32'),'nested\\image name.png')
    assert.equal(relativePreviewAsset('nested/README.md','img.png','local','darwin'),'nested/img.png')
    assert.notEqual(workspacePath('local','win32').dirname('one\\a.png'),workspacePath('local','win32').dirname('two\\b.png'))
})
