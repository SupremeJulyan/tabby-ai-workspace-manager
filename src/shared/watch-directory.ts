import { setInterval, clearInterval } from 'node:timers'
import { watch, FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

/** Watch visible directories only; recursive fs.watch walks the whole tree on Linux. */
export function watchLocalDirectory(root: string, changed: () => void, failed: (error: Error) => void, signal: AbortSignal, directories:()=>string[]=()=>['.']): Promise<void> {
    return new Promise((finish, reject) => {
        signal.throwIfAborted()
        const watchers=new Map<string,FSWatcher>()
        const close=()=>{clearInterval(timer);signal.removeEventListener('abort',close);for(const watcher of watchers.values())watcher.close();watchers.clear();finish()}
        const sync=()=>{
            if(signal.aborted)return
            const targets=new Set(directories().slice(0,32).map(path=>resolve(root,path)))
            for(const [path,watcher] of watchers)if(!targets.has(path)){watcher.close();watchers.delete(path)}
            for(const path of targets){
                if(watchers.has(path))continue
                try{
                    const watcher=watch(path,()=>changed())
                    watcher.on('error',error=>{watcher.close();watchers.delete(path);failed(error)})
                    watchers.set(path,watcher)
                }catch(error){if(path===resolve(root)){reject(error);close();return}}
            }
        }
        const timer=setInterval(sync,1000)
        timer.unref()
        signal.addEventListener('abort',close,{once:true})
        sync()
    })
}
