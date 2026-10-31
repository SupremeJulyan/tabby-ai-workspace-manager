import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteGit } from '../src/arw-tree/git/remote-git'
import { parseGitBranches, parseGitHistory, parseSwitchError } from '../src/arw-tree/git/git-history'
import { localWorkspace } from '../src/arw-tree/workspace'
import { parseDiff } from '../src/arw-tree/git/diff-model'
import { readGitSyncState, readCommitSyncHistory } from '../src/arw-tree/git/git-sync-state'

test('Git history parser keeps exact formatted commits and rejects malformed records', () => {
    const one = 'a'.repeat(40), two = 'b'.repeat(40)
    const parsed = parseGitHistory(`\x1e${one}\x1fAlice\x1f2026-01-01T00:00:00Z\x1f\x1ffirst commit\x1d\n\x1e${two}\x1fBob\x1f2026-01-02T00:00:00Z\x1f${one}\x1fmerge\x1d`)
    assert.deepEqual(parsed.map(commit => commit.subject), ['first commit', 'merge'])
    assert.equal(parsed[0].shortHash, 'aaaaaaaa')
    assert.throws(() => parseGitHistory('\x1enot-a-hash\x1fA\x1fnow\x1f\x1fx'), /Invalid Git history/)
    assert.deepEqual(parseGitBranches('feature\nmain\nHEAD\n', 'feature'), [{name:'feature', current:true}, {name:'HEAD', current:false}, {name:'main', current:false}])
    assert.match(parseSwitchError(new Error('error: Your local changes would be overwritten by checkout')).message, /不会自动 stash|提交或还原|不会自动/ )
})

test('local Git history, branches, first commit and safe branch switching', async context => {
    const root = await mkdtemp(join(tmpdir(), 'arw-git-history-'))
    context.after(() => rm(root, {recursive:true, force:true}))
    const workspace = localWorkspace(root)
    // Inherit a translated Git environment without changing the test process locale.
    const git = new RemoteGit(command => workspace.run(`LC_ALL=zh_CN.UTF-8 LANGUAGE=zh_CN ${command}`))
    for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'ARW Test'], ['config', 'user.email', 'arw@example.test']]) await git.run(args)
    assert.deepEqual(await git.history(), [])
    assert.deepEqual(await git.branches(), [{name:'main',current:true}])
    await writeFile(join(root, 'file.txt'), 'first\n')
    await git.run(['add', '.'])
    await git.commit('initial')
    assert.deepEqual(await git.branches(), [{name:'main', current:true}])
    let history = await git.history()
    assert.equal(history.length, 1)
    assert.equal(history[0].subject, 'initial')
    const first = await git.showCommit(history[0].hash)
    assert.match(first, /diff --git/)
    assert.match(first, /\+first/)
    assert.match(first, /new file mode/)
    assert.equal(parseDiff(first).hunks[0].file,'a/file.txt b/file.txt')
    await git.run(['switch', '-c', 'feature'])
    await writeFile(join(root, 'file.txt'), 'feature\n')
    await git.run(['add', '.'])
    await git.commit('feature work')
    await git.switchBranch('main')
    assert.equal(await git.run(['rev-parse', '--abbrev-ref', 'HEAD']), 'main\n')
    assert.equal((await git.branches()).find(branch => branch.current)?.name, 'main')
    assert.equal((await git.workingChangeCount()), 0)
    await writeFile(join(root, 'file.txt'), 'uncommitted\n')
    assert.equal(await git.workingChangeCount(), 1)
    await assert.rejects(git.switchBranch('feature'), /提交或还原/)
    assert.equal(await readFile(join(root,'file.txt'),'utf8'),'uncommitted\n')
    assert.equal(await git.run(['rev-parse', '--abbrev-ref', 'HEAD']), 'main\n')
    history = await git.history()
    assert.equal(history.length, 1)
    await assert.rejects(git.switchBranch('--detach'), /Invalid Git branch/)
    assert.equal(parseDiff(await git.showCommit(history[0].hash)).added, 1)
    await git.run(['restore', '--', 'file.txt'])
    await git.switchBranch('feature')
    const feature = (await git.history())[0]
    assert.equal(feature.subject, 'feature work')
    const featurePatch = await git.showCommit(feature.hash)
    assert.match(featurePatch, /-first/)
    assert.match(featurePatch, /\+feature/)
    await git.run(['switch', '--detach', feature.hash])
    assert.ok((await git.branches()).every(branch=>!branch.current))
    assert.equal((await git.history())[0].hash, feature.hash)
    await git.switchBranch('main')
    await writeFile(join(root,'other.txt'),'other\n')
    await git.run(['add','.']); await git.commit('other file')
    await git.run(['merge','--no-ff','feature','-m','merge feature'])
    const merged = (await git.history())[0]
    assert.equal(merged.subject,'merge feature')
    assert.match(await git.showCommit(merged.hash), /\+feature/)
    await assert.rejects(git.history(0), /Invalid Git history limit/)
})

test('Git history retains the full 50 entry bound and treats subjects as text',()=>{
    const records=Array.from({length:51},(_,index)=>`\x1e${index.toString(16).padStart(40,'0')}\x1fAuthor\x1f2026-01-01T00:00:00Z\x1f\x1f<img src=x>${index}\x1d\n`).join('')
    const commits=parseGitHistory(records)
    assert.equal(commits.length,50)
    assert.equal(commits[49].subject,'<img src=x>49')
})

test('remote Git inspection reduces exec requests and avoids history walks when upstream equals HEAD',async context=>{
    const root=await mkdtemp(join(tmpdir(),'arw-git-inspection-'))
    context.after(()=>rm(root,{recursive:true,force:true}))
    const workspace=localWorkspace(root)
    let requests=0
    const git=new RemoteGit(command=>{requests++;return workspace.run(command)})
    for(const args of [['init','-b','main'],['config','user.name','Test'],['config','user.email','test@example.com'],
        ['commit','--allow-empty','-m','initial'],['config','branch.main.remote','.'],['config','branch.main.merge','refs/heads/main']])await git.run(args)
    requests=0
    const commits=await git.history()
    assert.equal(commits.length,1);assert.equal(requests,1)
    requests=0
    assert.deepEqual(await git.branches(),[{name:'main',current:true}]);assert.equal(requests,1)
    requests=0
    const state=await readGitSyncState(git)
    assert.equal(state.kind,'tracked');assert.equal(state.ahead,0);assert.equal(state.behind,0)
    assert.equal(requests,3)
    requests=0
    const synced=await readCommitSyncHistory(git,commits,state)
    assert.equal(synced[0].syncStatus,'synced');assert.equal(requests,0)
})
