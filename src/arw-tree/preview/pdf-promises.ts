/** Older Zone.js replaces the native Promise without forwarding newer static methods. */
export function ensurePdfPromiseSupport(constructor:PromiseConstructor=Promise):void {
    const target=constructor as PromiseConstructor&{withResolvers?:unknown;try?:unknown}
    if(typeof target.withResolvers!=='function')Object.defineProperty(target,'withResolvers',{
        configurable:true,writable:true,value:function<T>(this:PromiseConstructor){
            let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason?:unknown)=>void
            const promise=new this<T>((yes,no)=>{resolve=yes;reject=no})
            return {promise,resolve,reject}
        },
    })
    if(typeof target.try!=='function')Object.defineProperty(target,'try',{
        configurable:true,writable:true,value:function<T>(this:PromiseConstructor,callback:(...args:any[])=>T,...args:any[]){
            return new this<Awaited<T>>(resolve=>resolve(callback(...args) as Awaited<T>))
        },
    })
}
