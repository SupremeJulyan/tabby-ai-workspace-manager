/** Limit outstanding I/O while allowing independent branches to make progress. */
export function limitConcurrency(limit:number) {
    let running=0
    const waiting:Array<()=>void>=[]
    return async function run<T>(operation:()=>Promise<T>):Promise<T> {
        if(running>=limit)await new Promise<void>(resolve=>waiting.push(resolve))
        else running++
        try {return await operation()}
        finally {
            const next=waiting.shift()
            if(next)next()
            else running--
        }
    }
}
