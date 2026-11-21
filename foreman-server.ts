import {DEFAULT_LANGUAGE,dataText,quoteLines,translator,type Language} from './i18n';
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import roster from './team.json';
import type {Board,BoardRow} from './board';
import {withBoardLock} from './board-lock';
import {threadOnBoard} from './board-thread';
import {updateRowStatus} from './board-metrics';
import {FOREMAN_CRON,FOREMAN_SCHEDULE,HALF_HOUR,TWO_HOURS,foremanHours,safeThread,executorOnBoard,nudgeDecision,pickup,waitingSummary,summaryHash,summaryText,type ForemanThread,type NudgeState,type TurnStamp,type WaitingItem} from './foreman';

const BOARD='board:',STATE='foreman:board:';
interface RowState extends NudgeState {silentSince?:number}
interface State {enabled:boolean;rows:Record<string,RowState>;summaryHash?:string;summaryAt?:number;pickups?:Record<string,{text:string;lastAttemptAt?:number}>}
const savedState=z.object({enabled:z.boolean(),rows:z.record(z.string(),z.object({threadId:z.string(),replySeq:z.number().int().nonnegative(),streak:z.number().int().nonnegative(),lastSentAt:z.number().nullable(),silentSince:z.number().optional()})),summaryHash:z.string().optional(),summaryAt:z.number().optional(),pickups:z.record(z.string(),z.object({text:z.string(),lastAttemptAt:z.number().optional()})).optional()});
const boardInput=z.object({boardId:z.string().min(1)}).strict();
const statusOut=z.object({boardId:z.string(),enabled:z.boolean(),cron:z.string(),summaryAt:z.number().nullable()});
const waitingItem=z.object({boardId:z.string(),rowId:z.string(),task:z.string(),roleId:z.string(),threadId:z.string().nullable(),kind:z.enum(['waiting','silent']),since:z.number(),ageMs:z.number(),note:z.string()});
export const foremanRpc={
 foremanEnable:{input:boardInput,output:statusOut},
 foremanDisable:{input:boardInput,output:statusOut},
 foremanStatus:{input:boardInput,output:statusOut},
 getWaitingSummary:{input:z.object({projectId:z.string().min(1).optional(),boardId:z.string().min(1).optional()}).strict(),output:z.object({items:z.array(waitingItem),hash:z.string(),fetchedAt:z.number()})},
};
interface Options {getLanguage?:()=>Promise<Language>;experimental?:()=>Promise<boolean>;now?:()=>number;saveBoard?:(board:Board)=>Promise<void>}
const blank=():State=>({enabled:false,rows:{}});
const short=(e:unknown)=>String((e as Error)?.message??e).slice(0,300);
export function registerForeman(bb:BbPluginApi,opts:Options={}){
 const now=opts.now??Date.now;
 const language=async()=>await opts.getLanguage?.()??DEFAULT_LANGUAGE;
 const locale=async()=>translator(await language());
 const coordinators=new Set(Object.values(roster.coordinatorByProject));
 let disposed=false;bb.onDispose(()=>{disposed=true;});
 const load=(id:string)=>bb.storage.kv.get<Board>(BOARD+id);
 const state=async(id:string):Promise<State>=>{const parsed=savedState.safeParse(await bb.storage.kv.get(STATE+id));return parsed.success?parsed.data:blank();};
 const saveState=(id:string,s:State)=>bb.storage.kv.set(STATE+id,s);
 const saveBoard=opts.saveBoard??(async(b:Board)=>{b.updatedAt=now();await bb.storage.kv.set(BOARD+b.id,b);bb.realtime.publish('board-changed',{boardId:b.id,projectId:b.projectId});});
 const warn=(e:unknown)=>bb.log.warn('[cyber-office foreman] '+short(e));
 const executor=async(b:Board,r:BoardRow,t:ForemanThread)=>!coordinators.has(t.id)&&executorOnBoard(b,r,t)&&(await bb.storage.kv.get<string>('role:'+t.id))!=='stas';
 const coordinator=async(b:Board)=>{
  const t=await threadOnBoard(bb,b,b.currentThreadId);
  return t&&b.shifts.includes(t.id)&&safeThread(t)?t:null;
 };
 async function rowThread(b:Board,r:BoardRow,s?:State){
  const t=r.threadId?await threadOnBoard(bb,b,r.threadId):null;
  if(s&&r.threadId){
   const invalid=!t;
   if(invalid)delete s.rows[r.id];
   if(invalid!==!!r.invalidThread){
    if(t)delete r.invalidThread;else r.invalidThread=true;
    await saveBoard(b);
   }
  }
  return t&&await executor(b,r,t)?t:null;
 }
 const send=async(id:string,text:string)=>{if(disposed)return;await bb.sdk.threads.send({threadId:id,input:[{type:'text',text,mentions:[]}],mode:'queue-if-active'});};
 async function boards(){
  const result:Board[]=[];
  for(const key of await bb.storage.kv.list(BOARD)){
   const b=await bb.storage.kv.get<Board>(key);if(!b)continue;
   coordinators.add(b.currentThreadId);for(const id of b.shifts)coordinators.add(id);
   if(await coordinator(b))result.push(b);
  }
  return result;
 }
 async function turnOf(b:Board,r:BoardRow,threadId:string,s?:State):Promise<TurnStamp>{
  const latest=(await bb.sdk.threads.events.list({threadId,types:['turn/completed','turn/started'],order:'desc',limit:'1'}))[0];
  if(!latest)return {at:r.createdAt,seq:0,replied:false};
  const completed=latest.type==='turn/completed'&&latest.data.status==='completed';
  const replied=completed&&!!await rowThread(b,r,s)&&!!(await bb.sdk.threads.output({threadId})).output?.trim();
  return {at:latest.createdAt,seq:latest.seq,replied};
 }
 async function summaryFor(list:Board[],at:number):Promise<WaitingItem[]>{
  const silent=new Map<string,number>();const filtered:Board[]=[];
  for(const b of list){
   const s=await state(b.id);const rows=[];
   for(const r of b.rows){
    // Без треда waiting всё равно требует решения пользователя. Чужие/тестовые треды исключены.
    if(!r.threadId){if(r.status==='waiting')rows.push(r);continue;}
    try{
     const t=await rowThread(b,r);if(!t)continue;
     rows.push(r);const st=s.rows[r.id];
     if(s.enabled&&st?.threadId===t.id&&st.streak>=3){
      const decision=nudgeDecision(b,r,t,await turnOf(b,r,t.id),st,at);
      if(decision.silent)silent.set(b.id+':'+r.id,st.silentSince??st.lastSentAt??r.updatedAt);
     }
    }catch{/* тред удалён или недоступен */}
   }
   filtered.push({...b,rows});
  }
  return waitingSummary(filtered,silent,at);
 }
 async function deliverPickups(b:Board,s:State){
  for(const [rowId,pending] of Object.entries(s.pickups??{})){
   if(disposed)return;
   const row=b.rows.find(r=>r.id===rowId);
   if(row?.status!=='review'||!await rowThread(b,row,s)){delete s.pickups![rowId];await saveState(b.id,s);continue;}
   if(pending.lastAttemptAt!=null&&now()-pending.lastAttemptAt<HALF_HOUR)continue;
   try{
    const tr=await locale();
    pending.lastAttemptAt=now();await saveState(b.id,s);
    const jar=await coordinator(b);if(!jar)continue;
    await send(jar.id,[tr('foreman_delivery'),'',tr('board_prompt_data'),quoteLines(pending.text)].join('\n'));delete s.pickups![rowId];await saveState(b.id,s);
   }catch(e){warn(e);}
  }
 }
 async function pickUpRow(b:Board,s:State,rowId:string,text:string|null,at:number){
  const r=b.rows.find(r=>r.id===rowId);if(!r?.threadId)return false;
  const t=await rowThread(b,r,s);if(!t)return false;
  const result=pickup(b,r,t,text);if(!result)return false;
  updateRowStatus(r,'review',at);r.note=result.note;
  delete s.rows[r.id];
  if(result.next){
   const lang=await language();
   const role=dataText(lang,roster.roles.find(x=>x.id===r.roleId)?.name??r.roleId);
   (s.pickups??={})[r.id]={text:translator(lang)('foreman_delivery_rows',r.task,role,result.next.task)};
  }
  await saveBoard(b);await saveState(b.id,s);await deliverPickups(b,s);
  return true;
 }
 async function visit(id:string){
  if(opts.experimental&&!(await opts.experimental()))return;
  return withBoardLock(bb,id,async()=>{
   if(disposed)return;const b=await load(id),s=await state(id);if(!b||!s.enabled)return;
   if(!await coordinator(b))return;
   const at=now();if(!foremanHours(at))return;
   await deliverPickups(b,s);
   for(const r of b.rows){
    if(disposed)return;if(!r.threadId||!['working','waiting'].includes(r.status))continue;
    try{
     const t=await rowThread(b,r,s);if(!t)continue;
     const turn=await turnOf(b,r,t.id,s);
     if(r.invalidThread)continue;
     // События закрытого BB не переигрываются: готовое подхватывается следующим обходом.
     if(t.status==='idle'&&turn.replied&&turn.at>=r.updatedAt&&await rowThread(b,r,s)){
      const {output}=await bb.sdk.threads.output({threadId:t.id});
      if(await pickUpRow(b,s,r.id,output,at))continue;
     }
     const d=nudgeDecision(b,r,t,turn,s.rows[r.id]??null,at);
     s.rows[r.id]={...d.state,...(d.silent?{silentSince:s.rows[r.id]?.silentSince??at}:{})};
     if(!d.due)continue;
     // Резервируем до send: неизвестный исход сетевого запроса не создаст дубль/расход.
     r.foremanAt=at;r.nudges=(r.nudges??0)+1;
     s.rows[r.id]={...d.state,streak:d.state.streak+1,lastSentAt:at,...(d.state.streak===2?{silentSince:at}:{})};
     await saveState(id,s);await saveBoard(b);
     const tr=await locale();
     if(await rowThread(b,r,s))await send(t.id,[tr('foreman_prompt'),'',tr('board_prompt_data'),quoteLines([r.task,r.note].filter(Boolean).join('\n'))].join('\n'));
    }catch(e){warn(e);}
   }
   await saveState(id,s);
   const items=await summaryFor([b],at);const hash=summaryHash(items);
   if((items.length||s.summaryHash)&&hash!==s.summaryHash&&(s.summaryAt==null||at-s.summaryAt>=TWO_HOURS)){
    const summary=summaryText(items,await language());
    const jar=await coordinator(b);if(!jar)return;
    s.summaryAt=at;await saveState(id,s);await send(jar.id,summary);
    s.summaryHash=hash;await saveState(id,s);
   }
  });
 }
 bb.background.schedule(FOREMAN_SCHEDULE,FOREMAN_CRON,async()=>{
  if(disposed||!foremanHours(now()))return;
  for(const b of await boards()){try{await visit(b.id);}catch(e){warn(e);}}
 });
 bb.events.on('thread.idle',async({thread,lastAssistantText})=>{
  if(opts.experimental&&!(await opts.experimental()))return;
  if(disposed||!safeThread(thread))return;
  for(const board of await boards()){
   if(!board.rows.some(r=>r.threadId===thread.id))continue;
   try{await withBoardLock(bb,board.id,async()=>{
    if(disposed)return;const b=await load(board.id),s=await state(board.id);if(!b||!s.enabled)return;
    for(const r of b.rows.filter(r=>r.threadId===thread.id)){
     if(!await rowThread(b,r,s))continue;
     if(lastAssistantText?.trim()){
      const st=s.rows[r.id];const turn=st?await turnOf(b,r,thread.id,s):null;
      if(st&&turn?.replied&&turn.seq>st.replySeq){st.streak=0;delete st.silentSince;st.replySeq=turn.seq;}
     }
     await pickUpRow(b,s,r.id,lastAssistantText,now());
    }
    await saveState(b.id,s);
   });}catch(e){warn(e);}
  }
 });
 const status=(id:string,s:State)=>({boardId:id,enabled:s.enabled,cron:FOREMAN_CRON,summaryAt:s.summaryAt??null});
 async function setEnabled(boardId:string,enabled:boolean){return withBoardLock(bb,boardId,async()=>{
  const b=await load(boardId);if(!b)throw new Error((await locale())('board_unavailable',boardId));
  if(enabled&&!await coordinator(b))throw new Error((await locale())('foreman_board_unavailable'));
  const s=await state(boardId);s.enabled=enabled;await saveState(boardId,s);return status(boardId,s);
 });}
 return {handlers:{
  foremanEnable:({boardId}:{boardId:string})=>setEnabled(boardId,true),
  foremanDisable:({boardId}:{boardId:string})=>setEnabled(boardId,false),
  async foremanStatus({boardId}:{boardId:string}){if(!await load(boardId))throw new Error((await locale())('board_unavailable',boardId));return status(boardId,await state(boardId));},
  async getWaitingSummary({projectId,boardId}:{projectId?:string;boardId?:string}){
   const at=now();const list=(await boards()).filter(b=>(!projectId||b.projectId===projectId)&&(!boardId||b.id===boardId));
   const items=await summaryFor(list,at);return {items,hash:summaryHash(items),fetchedAt:at};
  },
 }};
}
