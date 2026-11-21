import {useText,useLanguage} from './i18n-ui';
import type {rpcContract} from './server';
import type {useRpc} from '@get-bb/plugin-sdk/app';
import {guard} from './compat-app';
import {waitingAge,type WaitingItem} from './foreman';
import type {TeamStatus} from './model';

let enabled=false;
export function registerForemanUI(){enabled=true;}
export function waitingRailStatus(threadId:string,items:WaitingItem[]|null|undefined,fallback:TeamStatus):TeamStatus{
 return enabled&&items?.some(x=>x.threadId===threadId)?'waiting':fallback;
}
export async function readWaitingSummary(rpc:ReturnType<typeof useRpc<typeof rpcContract>>,projectId:string){
 if(!enabled)return null;
 try{return (await rpc.call('getWaitingSummary',{projectId})).items;}catch{return null;}
}
function Age({threadId,items}:{threadId:string;items?:WaitingItem[]|null}){
 const tr=useText();const lang=useLanguage();
 const row=items?.filter(x=>x.threadId===threadId).sort((a,b)=>a.since-b.since)[0];
 if(!enabled||!row)return null;
 return <small title={tr("since")+new Date(row.since).toLocaleString(lang)}>{row.kind==='silent'?tr("no_reply_for"):tr("waiting")} {waitingAge(row.ageMs,lang)}</small>;
}
export const WaitingAge=guard('foreman',Age);

export function extraWaiting(items:WaitingItem[]|null|undefined,threadIds:string[]){
 return enabled?(items??[]).filter(x=>!x.threadId||!threadIds.includes(x.threadId)):[];
}
function ExtraRows({rows,onThread}:{rows:WaitingItem[];onThread:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 if(!rows.length)return null;
 return <ul>{rows.map(r=><li key={r.boardId+':'+r.rowId}>{r.threadId?
  <button onClick={()=>onThread(r.threadId!)}><span className="km-rail-text"><b>{r.task}</b><Age threadId={r.threadId} items={[r]}/></span><i>{tr("open")}</i></button>:
  <p className="km-rail-empty"><b>{r.task}</b><br/>{tr("waiting")} {waitingAge(r.ageMs,lang)} {tr("no_thread_linked")}</p>
 }</li>)}</ul>;
}
export const ForemanWaitingRows=guard('foreman',ExtraRows);
