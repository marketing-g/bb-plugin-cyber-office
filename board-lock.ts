import type {BbPluginApi} from '@get-bb/plugin-sdk';

// Общий замок диспетчера и Прораба: оба меняют один JSON доски в kv.
const hosts=new WeakMap<object,Map<string,Promise<unknown>>>();
export function withBoardLock<T>(bb:BbPluginApi,id:string,fn:()=>Promise<T>):Promise<T>{
 let locks=hosts.get(bb);if(!locks){locks=new Map();hosts.set(bb,locks);}
 const next=(locks.get(id)??Promise.resolve()).catch(()=>{}).then(fn);
 const tail=next.then(()=>{},()=>{});locks.set(id,tail);
 void tail.then(()=>{if(locks!.get(id)===tail)locks!.delete(id);});
 return next;
}
