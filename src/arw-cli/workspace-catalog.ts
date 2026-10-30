import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface SavedWorkspace {
    workspaceId: string
    workspaceRoot: string
    name: string
    kind?: 'local'|'remote'
    host: string
    port?: number
    user?: string
    status: 'saved'|'forwarded'
    configPath?: string
}

export function workspaceCatalogPath (): string {
    const config = process.env.TABBY_CONFIG_DIRECTORY ?? (
        process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'tabby')
            : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'tabby')
                : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tabby'))
    return join(config, 'omw', 'workspaces.json')
}

export async function writeWorkspaceCatalog (file: string, workspaces: SavedWorkspace[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
        await writeFile(temporary, JSON.stringify({version:1,workspaces}), { mode:0o600, flag:'wx' })
        await rename(temporary,file)
    } finally { await unlink(temporary).catch(()=>undefined) }
}

export async function readWorkspaceCatalog (file = workspaceCatalogPath()): Promise<{workspaces: SavedWorkspace[]}> {
    let text: string | undefined
    try { text=await readFile(file,'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') text=undefined; else throw error }
    const catalog=text===undefined?{version:1,workspaces:[]}:JSON.parse(text)
    if (catalog?.version!==1 || !Array.isArray(catalog.workspaces) || catalog.workspaces.some((entry:SavedWorkspace & {kind?:string})=>
        !entry || typeof entry.workspaceId!=='string' || typeof entry.workspaceRoot!=='string'
        || typeof entry.name!=='string' || typeof entry.host!=='string'
        || (entry.kind!==undefined && !['local','remote'].includes(entry.kind)) || !['saved','forwarded'].includes(entry.status)
        || (entry.status==='forwarded' && typeof entry.configPath!=='string'))) {
        throw new Error('Invalid saved workspace catalog')
    }
    const active = join(dirname(file), 'active-workspaces')
    const names = await readdir(active).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const name of names.filter(name => name.endsWith('.json'))) {
        let entry: SavedWorkspace & {pid?:number}
        try { entry=JSON.parse(await readFile(join(active,name),'utf8')) }
        catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') continue; throw error }
        if (!Number.isSafeInteger(entry.pid) || !entry.pid || entry.pid<1 || typeof entry.workspaceId!=='string' || typeof entry.configPath!=='string' || typeof entry.workspaceRoot!=='string' || typeof entry.host!=='string' || typeof entry.name!=='string' || entry.status!=='forwarded') throw new Error('Invalid active workspace catalog')
        try { process.kill(entry.pid,0) } catch (error) { if ((error as NodeJS.ErrnoException).code==='ESRCH') continue; throw error }
        if (!catalog.workspaces.some((saved:SavedWorkspace)=>saved.workspaceId===entry.workspaceId)) {
            const {pid:_pid,...workspace}=entry
            catalog.workspaces.push(workspace)
        }
    }
    return {workspaces:catalog.workspaces
        .filter((entry:SavedWorkspace & {kind?:string})=>entry.kind!=='local')
        .map(({kind: _kind,...entry}:SavedWorkspace & {kind?:string})=>entry)}
}

/** Separate live registrations prevent saved-project catalog writes from hiding manual forwards. */
export async function registerActiveWorkspace (catalog: string, entry: SavedWorkspace): Promise<()=>Promise<void>> {
    const directory=join(dirname(catalog),'active-workspaces')
    await mkdir(directory,{recursive:true,mode:0o700})
    const file=join(directory,randomUUID()+'.json'), temporary=file+'.tmp'
    try {
        await writeFile(temporary,JSON.stringify({...entry,pid:process.pid}),{mode:0o600,flag:'wx'})
        await rename(temporary,file)
    } finally {await unlink(temporary).catch(()=>undefined)}
    return ()=>unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error})
}
