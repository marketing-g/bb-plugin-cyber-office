// Журнал передач по доске. Формат директивы и работа с журналом живут здесь.
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {PASS_EVENT,passTime} from './pass-display';
export {PASS_EVENT,PASS_NAMES,PASS_THREAD,groupPasses,parsePassDirective,passName,passTime} from './pass-display';
export type {PassDirective} from './pass-display';
import type {Board,BoardRow,BoardStatus} from './board';
import type {RoutePlan,RouteTarget} from './route';

export const PASS_LIMIT=300;
export const PASS_KEY='passes:';
export const passSchema=z.object({at:z.number().int().min(0).max(8640000000000000),from:z.string().min(1).max(80),to:z.string().min(1).max(80),task:z.string().min(1).max(300),threadId:z.string().nullable(),kind:z.enum(['dispatch','answer','shift','done','review'])});
export type PassEvent=z.infer<typeof passSchema>;
export const passRpc={getPasses:{input:z.object({projectId:z.string().min(1)}).strict(),output:z.object({passes:z.array(passSchema.extend({boardId:z.string()}))})}};
export type ProjectPass=PassEvent&{boardId:string};
const one=(s:string,max=300)=>s.replace(/\s+/g,' ').trim().slice(0,max);

// Markdown directive attributes use quoted strings, not JSON escapes. Entities round-trip safely.
const quote=(s:string)=>one(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/{/g,'&#123;').replace(/}/g,'&#125;').replace(/\\/g,'&#92;');
export function dispatchPassDirective(role:string,task:string,thread:string,at:number):string{
 return `::team-pass{from="user" via="stas" to="${quote(role)}" task="${quote(task)}" at="${passTime(at)}" thread="${quote(thread)}"}`;
}

/** Старые события первыми в kv; последние 300. Дополнительно соблюдаем лимит kv 256 КБ. */
export function appendPasses(saved:unknown,events:readonly PassEvent[]):PassEvent[]{
 const out=[...(Array.isArray(saved)?saved:[]),...events].flatMap(e=>{const p=passSchema.safeParse(e);return p.success?[p.data]:[];}).slice(-PASS_LIMIT);
 while(out.length&&new TextEncoder().encode(JSON.stringify(out)).length>240*1024)out.shift();
 return out;
}

const locks=new WeakMap<object,Map<string,Promise<void>>>();
/** Ошибка необязательного журнала не отменяет уже выполненную передачу. */
export async function writePasses(bb:BbPluginApi,boardId:string,events:readonly PassEvent[]){
 let map=locks.get(bb);if(!map){map=new Map();locks.set(bb,map);}
 const key=PASS_KEY+boardId;const previous=map.get(key)??Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  await bb.storage.kv.set(key,appendPasses(await bb.storage.kv.get(key),events));
  try{bb.realtime.publish(PASS_EVENT,{boardId});}catch{/* периодическое чтение восстановит журнал */}
 }).catch(e=>{try{bb.log.warn('[cyber-office pass] '+String(e));}catch{/* лог недоступен */}});
 map.set(key,next);await next;if(map.get(key)===next)map.delete(key);
}
export async function logDispatchPass(bb:BbPluginApi,boardId:string,role:string,task:string,threadId:string,coordinator:string,at:number){
 await writePasses(bb,boardId,[{at,from:'user',to:'stas',task:one(task),threadId:coordinator,kind:'dispatch'},{at,from:'stas',to:role,task:one(task),threadId,kind:'dispatch'}]);
 return dispatchPassDirective(role,task,threadId,at);
}
export async function logStatusPass(bb:BbPluginApi,boardId:string,row:BoardRow,previous:BoardStatus){
 if(previous===row.status||(row.status!=='review'&&row.status!=='done'))return;
 await writePasses(bb,boardId,[{at:row.updatedAt,from:row.roleId,to:'stas',task:one(row.task),threadId:row.threadId,kind:row.status}]);
}
export async function logShiftPass(bb:BbPluginApi,b:Board,at:number){
 await writePasses(bb,b.id,[{at,from:'shift:'+(b.shifts.length-1),to:'shift:'+b.shifts.length,task:'Shift handoff',threadId:b.shifts.at(-1)??null,kind:'shift'}]);
}
/** Только успешная доставка, включая очередь. Одно событие на каждую подходящую доску. */
export async function logRoutePass(bb:BbPluginApi,plan:RoutePlan,target:RouteTarget|undefined,threadId:string,at:number){
 try{
  for(const key of await bb.storage.kv.list('board:')){
   const b=await bb.storage.kv.get<Board>(key);if(!b||b.projectId!==plan.projectId)continue;
   for(const row of b.rows.filter(r=>r.threadId===threadId))await writePasses(bb,b.id,[{at,from:'user',to:target?.roleId??row.roleId,task:one(row.task),threadId,kind:'answer'}]);
  }
 }catch(e){try{bb.log.warn('[cyber-office pass] разнос: '+String(e));}catch{/* лог недоступен */}}
}
export function registerPassServer(bb:BbPluginApi){
 return {async getPasses({projectId}:{projectId:string}){
  const passes:ProjectPass[]=[];
  for(const key of await bb.storage.kv.list('board:')){
   const b=await bb.storage.kv.get<Board>(key);if(!b||b.projectId!==projectId)continue;
   passes.push(...appendPasses(await bb.storage.kv.get(PASS_KEY+b.id),[]).map(e=>({...e,boardId:b.id})));
  }
  return {passes:passes.reverse().sort((a,b)=>b.at-a.at)};
 }};
}
