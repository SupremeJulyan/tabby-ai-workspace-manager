/** russh-napi #3: independent native queues can deliver data after close.
 * Keep buffers alive only for ARW's exec channels until their output is drained.
 * Other channels, including the interactive terminal and SFTP, keep their cleanup.
 */
interface EventBuffer { closeChannel(id:number):void }
interface Guard {
    channels:Map<number,{users:number;closed:boolean}>
    original:EventBuffer['closeChannel']
    wrapper:EventBuffer['closeChannel']
}
const guards=new WeakMap<EventBuffer,Guard>()

export function retainExecEventBuffers(client:unknown,channel:unknown):()=>void {
    const events=(client as {events?:Record<string,unknown>})?.events
    const id=(channel as {id?:unknown})?.id
    if(!events||typeof id!=='number')return ()=>{}
    const releases:(()=>void)[]=[]
    for(const name of ['data$','extendedData$','eof$','close$']){
        const buffer=events[name] as EventBuffer|undefined
        if(!buffer||typeof buffer.closeChannel!=='function')continue
        let guard=guards.get(buffer)
        if(!guard){
            const original=buffer.closeChannel
            const channels:Guard['channels']=new Map()
            const wrapper=(channelId:number)=>{
                const retained=channels.get(channelId)
                if(retained)retained.closed=true
                else original.call(buffer,channelId)
            }
            guard={original,wrapper,channels};guards.set(buffer,guard);buffer.closeChannel=wrapper
        }
        const retained=guard.channels.get(id)??{users:0,closed:false}
        retained.users++;guard.channels.set(id,retained)
        const current=guard
        releases.push(()=>{
            if(--retained.users>0)return
            current.channels.delete(id)
            if(retained.closed)current.original.call(buffer,id)
            if(!current.channels.size){
                if(buffer.closeChannel===current.wrapper)buffer.closeChannel=current.original
                guards.delete(buffer)
            }
        })
    }
    let released=false
    return ()=>{if(!released){released=true;for(const release of releases)release()}}
}
