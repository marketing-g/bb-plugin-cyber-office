import {DEFAULT_LANGUAGE,translator,type Language} from './i18n';
import {roleExecution} from './compat';
// Радар по сигналу и раз в неделю. Подключение из server.ts: registerScout(bb,{cardOf,saveBoard}).
// По умолчанию выключен на всех досках: включает Claude или вы (RPC scoutEnable).
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import type {Board,BoardRow} from './board';
import type {Role} from './model';
import {withBoardLock} from './board-lock';
import {threadOnBoard} from './board-thread';
import {updateRowStatus} from './board-metrics';
import {safeThread,foremanHours} from './foreman';
import {SCOUT_WEEKLY_CRON,boardDigest,dayKey,pickBottleneck,scoutBrief,type ScoutPick} from './scout';

const BOARD='board:',STATE='scout:board:';
/** Проверка сигнала раз в час в рабочие часы. */
export const SCOUT_SIGNAL_CRON='20 9-22 * * *';
interface State {enabled:boolean;lastDay?:string;lastAt?:number;lastThread?:string;seen?:string[]}
const boardInput=z.object({boardId:z.string().min(1)}).strict();
const statusOut=z.object({boardId:z.string(),enabled:z.boolean(),lastAt:z.number().nullable(),lastThread:z.string().nullable()});
export const scoutRpc={
 scoutEnable:{input:boardInput,output:statusOut},
 scoutDisable:{input:boardInput,output:statusOut},
 scoutStatus:{input:boardInput,output:statusOut},
 /** Запуск вручную (проверка в песочнице). Лимит раз в день действует и здесь, кроме force. */
 scoutRunNow:{input:z.object({boardId:z.string().min(1),force:z.boolean().optional()}).strict(),output:z.object({threadId:z.string().nullable(),why:z.string()})},
};
interface Options {getLanguage?:()=>Promise<Language>;experimental?:()=>Promise<boolean>;cardOf:(role:string)=>Promise<Role|null>;saveBoard?:(b:Board)=>Promise<void>;now?:()=>number}

export function registerScout(bb:BbPluginApi,opts:Options){
 const now=opts.now??Date.now;
 const locale=async()=>translator(await opts.getLanguage?.()??DEFAULT_LANGUAGE);
 let disposed=false;bb.onDispose(()=>{disposed=true;});
 const load=(id:string)=>bb.storage.kv.get<Board>(BOARD+id);
 const state=async(id:string):Promise<State>=>(await bb.storage.kv.get<State>(STATE+id))??{enabled:false};
 const save=(id:string,s:State)=>bb.storage.kv.set(STATE+id,s);
 const saveBoard=opts.saveBoard??(async(b:Board)=>{b.updatedAt=now();await bb.storage.kv.set(BOARD+b.id,b);try{bb.realtime.publish('board-changed',{boardId:b.id,projectId:b.projectId});}catch{/* нет realtime */}});
 const warn=(e:unknown)=>bb.log.warn('[cyber-office scout] '+String((e as Error)?.message??e).slice(0,300));

 /** Один запуск: сигнал или недельный прогон. Возвращает тред или причину, почему нет. */
 async function run(boardId:string,mode:'signal'|'weekly'|'manual',force=false):Promise<{threadId:string|null;why:string}>{
  return withBoardLock(bb,boardId,async()=>{
   const lang=await opts.getLanguage?.()??DEFAULT_LANGUAGE;
   const tr=translator(lang);
   if(disposed)return {threadId:null,why:tr('scout_unloading')};
   const b=await load(boardId),s=await state(boardId);const at=now();
   if(!b)return {threadId:null,why:tr('scout_no_board')};
   if(!s.enabled&&mode!=='manual')return {threadId:null,why:tr('scout_disabled')};
   if(!force&&s.lastDay===dayKey(at))return {threadId:null,why:tr('scout_already_ran')};
   const jar=await threadOnBoard(bb,b,b.currentThreadId);
   if(!jar||!b.shifts.includes(jar.id)||!safeThread(jar))return {threadId:null,why:tr('scout_test_or_archived')};
   const rows=await Promise.all(b.rows.map(async r=>!r.threadId||await threadOnBoard(bb,b,r.threadId)?r:{...r,threadId:null,note:undefined}));
   const view={...b,rows};
   let pick:ScoutPick|null=pickBottleneck([view],at);
   if(pick&&(s.seen??[]).includes(pick.row.id+':'+(pick.row.reworks??0)))pick=null;
   if(!pick&&mode==='signal')return {threadId:null,why:tr('scout_no_signal')};
   const card=await opts.cardOf('radar');if(!card)return {threadId:null,why:tr('scout_no_card')};
   const ex=await roleExecution(bb,b.projectId,card.brains,card.providerAvailable)??{providerId:jar.providerId,model:'',reasoningLevel:''};
   const t=await bb.sdk.threads.spawn({projectId:b.projectId,environment:{type:'reuse',environmentId:jar.environmentId},providerId:ex.providerId,
    ...(ex.model?{model:ex.model}:{}),...(ex.reasoningLevel?{reasoningLevel:ex.reasoningLevel}:{}),
    parentThreadId:b.currentThreadId,title:`[${card.name}] ${pick?pick.row.task.slice(0,80):'Weekly review'}`,prompt:scoutBrief(pick,at,boardDigest([view],at),lang)} as Parameters<typeof bb.sdk.threads.spawn>[0]);
   await bb.storage.kv.set('role:'+t.id,'radar');
   const row:BoardRow={id:'r'+(b.rows.length+1),task:pick?tr('scout_signal_task',card.name,pick.row.task.slice(0,120)):tr('scout_weekly_task',card.name),roleId:'radar',status:'working',threadId:t.id,createdAt:at,updatedAt:at,note:pick?.why??tr('scout_scheduled')};
   updateRowStatus(row,'working',at);b.rows.push(row);await saveBoard(b);
   s.lastDay=dayKey(at);s.lastAt=at;s.lastThread=t.id;if(pick)s.seen=[...(s.seen??[]).slice(-50),pick.row.id+':'+(pick.row.reworks??0)];await save(boardId,s);
   try{bb.realtime.publish('roles-changed',{threadId:t.id});}catch{/* нет realtime */}
   return {threadId:t.id,why:pick?.why??tr('scout_weekly')};
  });
 }
 async function all(mode:'signal'|'weekly'){
  if(opts.experimental&&!(await opts.experimental()))return;
  if(disposed||!foremanHours(now()))return;
  for(const key of await bb.storage.kv.list(STATE)){const id=key.slice(STATE.length);try{await run(id,mode);}catch(e){warn(e);}}
 }
 bb.background.schedule('scout-signal',SCOUT_SIGNAL_CRON,()=>all('signal'));
 bb.background.schedule('scout-weekly',SCOUT_WEEKLY_CRON,()=>all('weekly'));
 const status=(id:string,s:State)=>({boardId:id,enabled:s.enabled,lastAt:s.lastAt??null,lastThread:s.lastThread??null});
 async function setEnabled(boardId:string,enabled:boolean){
  const b=await load(boardId);if(!b)throw new Error((await locale())('board_unavailable',boardId));
  const s=await state(boardId);s.enabled=enabled;await save(boardId,s);return status(boardId,s);
 }
 return {handlers:{
  scoutEnable:({boardId}:{boardId:string})=>setEnabled(boardId,true),
  scoutDisable:({boardId}:{boardId:string})=>setEnabled(boardId,false),
  async scoutStatus({boardId}:{boardId:string}){if(!await load(boardId))throw new Error((await locale())('board_unavailable',boardId));return status(boardId,await state(boardId));},
  scoutRunNow:({boardId,force}:{boardId:string;force?:boolean})=>run(boardId,'manual',!!force),
 }};
}
