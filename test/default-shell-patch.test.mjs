import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patchDefaultShell } from '../scripts/fix-default-shell.mjs'

const fixture = `async function launch(configured, shell_selection_1) {
          const selected = configured?.shell;
          if (!selected) throw new Error('Select a shell');
          const profiles = await this.profiles.getProfiles({ includeBuiltin: true });
          const available = (0, shell_selection_1.selectableShells)(profiles);
          const current = available.find(candidate => candidate.id === selected?.id);
          if (!current) throw new Error('Shell unavailable');
          return current;
}
function settings(preferred) {
this.shellId = this.shells.find((shell) => shell.id === preferred)?.id ?? "";
}`

test('patched launch resolves defaults and keeps explicit shell choices', async () => {
    const patched = patchDefaultShell(fixture)
    const { launch, settings } = new Function(`${patched}; return { launch, settings };`)()
    const shells = [{ id: 'local:default' }, { id: 'local:fish' }]
    const host = {
        profiles: { getProfiles: async () => shells },
        config: { store: { terminal: { profile: 'local:fish' } } },
        shells,
    }
    const selection = { selectableShells: profiles => profiles }
    assert.equal(await launch.call(host, {}, selection), shells[1])
    assert.equal(await launch.call(host, { shell: shells[0] }, selection), shells[0])
    host.config.store.terminal.profile = 'removed'
    assert.equal(await launch.call(host, { shell: null }, selection), shells[0])
    settings.call(host, 'removed')
    assert.equal(host.shellId, shells[0].id)
    await assert.rejects(launch.call(host, { shell: { id: 'removed' } }, selection), /unavailable/)
    host.profiles.getProfiles = async () => []
    await assert.rejects(launch.call(host, {}, selection), /unavailable/)
    assert.equal(host.config.store.omw, undefined)
    assert.equal(patchDefaultShell(patched), patched)
    assert.throws(() => patchDefaultShell('unknown'), /Unrecognized/)
})
