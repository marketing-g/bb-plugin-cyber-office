import type {Board,BoardRow} from './board';
import {DEFAULT_LANGUAGE,quoteLines,translator} from './i18n.ts';
import {parseItog} from './itog.ts';

export const HALF_HOUR=30*60_000;
export const TWO_HOURS=4*HALF_HOUR;
export const FOREMAN_CRON='*/30 9-23 * * *';
export const FOREMAN_SCHEDULE='foreman';
export interface ForemanThread {
 id:string;projectId:string;title:string|null;titleFallback?:string|null;archivedAt:number|null;deletedAt?:number|null;
 status:string;hasPendingInteraction?:boolean;queuedMessageCount?:number;activeBackgroundAgentCount?:number;
}
export interface NudgeState {threadId:string;replySeq:number;streak:number;lastSentAt:number|null}
export interface TurnStamp {at:number;seq:number;replied:boolean}
export interface WaitingItem {boardId:string;rowId:string;task:string;roleId:string;threadId:string|null;kind:'waiting'|'silent';since:number;ageMs:number;note:string}

/** Cron использует часы сервера BB. Последний разрешённый обход в 23:00, не в 23:30. */
export function foremanHours(at:number){const d=new Date(at);return d.getHours()>=9&&(d.getHours()<23||(d.getHours()===23&&d.getMinutes()===0));}
export function safeThread(t:ForemanThread){return t.archivedAt==null&&t.deletedAt==null&&!/^\s*(?:тест|test)\s*:/i.test(t.title||t.titleFallback||'');}
export function executorOnBoard(b:Board,r:BoardRow,t:ForemanThread){
 return t.projectId===b.projectId&&r.threadId===t.id&&r.roleId!=='stas'&&t.id!==b.currentThreadId&&!b.shifts.includes(t.id)&&safeThread(t);
}
export function nudgeDecision(b:Board,r:BoardRow,t:ForemanThread,turn:TurnStamp,state:NudgeState|null,at:number){
 const same=state?.threadId===t.id?state:null;
 const replied=turn.replied&&turn.seq>(same?.replySeq??0);
 const next:NudgeState={threadId:t.id,replySeq:replied?turn.seq:(same?.replySeq??0),streak:replied?0:(same?.streak??0),lastSentAt:same?.lastSentAt??r.foremanAt??null};
 const quiet=executorOnBoard(b,r,t)&&r.status==='working'&&!['active','starting','pending','stopping'].includes(t.status)&&!t.hasPendingInteraction&&!(t.queuedMessageCount??0)&&!(t.activeBackgroundAgentCount??0)&&at-turn.at>HALF_HOUR;
 return {state:next,silent:quiet&&next.streak>=3,due:quiet&&t.status==='idle'&&next.streak<3&&(next.lastSentAt==null||at-next.lastSentAt>=TWO_HOURS)};
}
/** Только закрытый блок, только последняя декларация статуса, повторный idle без перехода. */
export function completedItog(text:string|null):string|null{
 const blocks=[...(text??'').matchAll(/^\s*```itog[^\S\r\n]*\r?\n([\s\S]*?)^\s*```[^\S\r\n]*$/gim)];
 const it=blocks.length?parseItog(blocks.at(-1)![1]):null;
 return it?.status==='готово'&&it.summary.trim()?it.summary.replace(/\s+/g,' ').trim().slice(0,400):null;
}
export function pickup(b:Board,r:BoardRow,t:ForemanThread,text:string|null){
 if(!executorOnBoard(b,r,t)||t.status!=='idle'||!['working','waiting'].includes(r.status))return null;
 const note=completedItog(text);return note?{note,next:b.rows.find(x=>x.status==='todo')??null}:null;
}
export function waitingSummary(boards:Board[],silent:Map<string,number>,at:number):WaitingItem[]{
 return boards.flatMap(b=>b.rows.flatMap(r=>{
  const key=b.id+':'+r.id;const kind=r.status==='waiting'?'waiting':r.status==='working'&&silent.has(key)?'silent':null;
  if(!kind)return [];
  const since=kind==='waiting'?(r.waitingSince??r.updatedAt):(silent.get(key)!);
  return [{boardId:b.id,rowId:r.id,task:r.task,roleId:r.roleId,threadId:r.threadId,kind,since,ageMs:Math.max(0,at-since),note:r.note??''} as WaitingItem];
 })).sort((a,b)=>a.since-b.since||a.boardId.localeCompare(b.boardId)||a.rowId.localeCompare(b.rowId));
}
/** Возраст сам по себе не меняет состав списка и не тратит новый ход Стаса. */
export function summaryHash(items:WaitingItem[]):string{
 const text=JSON.stringify(items.map(({ageMs,...x})=>x).sort((a,b)=>(a.boardId+':'+a.rowId).localeCompare(b.boardId+':'+b.rowId)));
 let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);
}
export function waitingAge(ms:number,lang=DEFAULT_LANGUAGE){const m=Math.floor(Math.max(0,ms)/60_000);const tr=translator(lang);return m<60?tr("minutes",m):tr("hours",Math.floor(m/60))+(m%60?" "+tr("minutes",m%60):"");}
const one=(s:string,n:number)=>s.replace(/\s+/g,' ').trim().slice(0,n);
export function summaryText(items:WaitingItem[],lang=DEFAULT_LANGUAGE){
 const tr=translator(lang);
 const tasks=items.slice(0,8).map(x=>one(x.task,70)+(x.kind==='silent'?' '+tr('foreman_summary_silent'):''));
 if(items.length>8)tasks.push(tr('foreman_summary_more',items.length-8));
 const oldest=items.length?' '+tr('foreman_summary_oldest',waitingAge(Math.max(...items.map(x=>x.ageMs)),lang)):'';
 return tr('foreman_summary_heading',items.length)+oldest+'\n\n'+tr('board_prompt_data')+'\n'+quoteLines(tasks.join('\n')||tr('foreman_summary_empty'));
}
