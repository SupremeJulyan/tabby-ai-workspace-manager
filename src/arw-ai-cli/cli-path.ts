import { delimiter, dirname, join } from 'node:path'

/** Every invocation resolves the installed implementation; never copy the CLI into a session. */
export function currentCliPath(source:string,base=process.env.PATH??''):string {
    const bin=join(dirname(source),'bin')
    const directories=base.split(delimiter).filter(path=>path&&path!==bin)
    return [bin,...directories].join(delimiter)
}
