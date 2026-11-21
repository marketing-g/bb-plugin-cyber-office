import {useText,useLanguage} from './i18n-ui';
// Разнос ответа по агентам: форма подтверждения, ручная кнопка, журнал.
// Подключение из app.tsx: import {registerRoute} from './route-form'; registerRoute(app);
// Журнал в блоке «Cyber Office» треда: <RouteLogList threadId={threadId}/>.
import {useEffect,useMemo,useRef,useState} from 'react';
import {definePluginApp,experimental_useCodeTheme,useBbNavigate,useRealtime,useRpc} from '@get-bb/plugin-sdk/app';
import type {routeRpcContract} from './route-server';
import {statusText} from './model';
import {text} from './i18n.ts';
import {Sprite} from './ui';
import type {RouteLogEntry,RoutePlan,RouteRow,RouteSubmit,RouteTarget} from './route';
import './route.css';

type PluginApp=Parameters<Parameters<typeof definePluginApp>[0]>[0];
/** Должно совпадать с ROUTE_FORM_ID и ROUTE_LOG_EVENT в route-server.ts. */
const FORM_ID='route-form';
const LOG_EVENT='route-log';

function useTheme():'dark'|'light'{try{return experimental_useCodeTheme().mode==='light'?'light':'dark';}catch{return 'dark';}}

interface RowState {send:boolean;threadId:string|null;text:string}
function initial(plan:RoutePlan):RowState[]{return plan.rows.map(r=>({send:!r.blocked&&!!r.threadId,threadId:r.threadId,text:r.quote}));}
const canSend=(row:RouteRow,s:RowState)=>!row.blocked&&!!s.threadId&&!!s.text.trim();

/** Форма на месте поля ввода: что уйдёт, кому, с какими метками. */
export function RouteForm({plan,submit,cancel}:{plan:RoutePlan;submit:(v:RouteSubmit)=>Promise<void>;cancel:()=>Promise<void>}){
 const tr=useText();
 const theme=useTheme();
 const [rows,setRows]=useState<RowState[]>(()=>initial(plan));
 const [busy,setBusy]=useState<null|'send'|'cancel'>(null);const [error,setError]=useState<string|null>(null);
 const root=useRef<HTMLFormElement>(null);
 useEffect(()=>{root.current?.focus();},[]);
 const n=rows.filter((s,i)=>s.send&&canSend(plan.rows[i],s)).length;
 const set=(i:number,patch:Partial<RowState>)=>setRows(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));
 const go=async(kind:'send'|'cancel')=>{
  if(busy)return;setBusy(kind);setError(null);
  try{
   if(kind==='cancel')await cancel();
   else await submit({rows:rows.map((s,index)=>({index,threadId:s.threadId,text:s.text.trim(),send:s.send&&canSend(plan.rows[index],s)}))});
  }catch(e){setError(String((e as Error)?.message??e));setBusy(null);}
 };
 const from=plan.origin==='forward'?tr("forward_the_agent_s_reply"):tr("route_your_message");
 return <form ref={root} tabIndex={-1} className="km km-route" data-theme={theme} aria-labelledby="km-route-h"
  onSubmit={e=>{e.preventDefault();if(n)void go('send');}}
  onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&n){e.preventDefault();void go('send');}}}>
  <header className="km-route-head">
   <h2 id="km-route-h">{from} {tr("to_agents")}</h2>
   <p>{tr("from")}{plan.sourceTitle}» ({plan.sourceName}{tr("review_and_send_when_ready")}</p>
  </header>
  {plan.rows.length===0?<p className="km-route-empty">{tr("there_are_no_excerpts_to_route")}</p>:
  <ol className="km-route-rows">
   {plan.rows.map((row,i)=><Row key={i} index={i} row={row} state={rows[i]} plan={plan} onChange={p=>set(i,p)} disabled={!!busy}/>)}
  </ol>}
  {error&&<p className="km-route-error" role="alert">{tr("something_went_wrong")} {error}</p>}
  <footer className="km-route-foot">
   <button type="submit" className="km-route-send" disabled={!n||!!busy}>{busy==='send'?tr("sending_2"):tr("send_2", n)}</button>
   <button type="button" className="km-route-cancel" disabled={!!busy} onClick={()=>void go('cancel')}>{tr("cancel_2")}</button>
   <span className="km-route-hint">{tr("busy_agents_receive_the_message_after")}</span>
  </footer>
 </form>;
}

function Row({index,row,state,plan,onChange,disabled}:{index:number;row:RouteRow;state:RowState;plan:RoutePlan;onChange:(p:Partial<RowState>)=>void;disabled:boolean}){
 const tr=useText();
 const nav=useBbNavigate();
 const target=plan.recipients.find(t=>t.threadId===state.threadId)??null;
 const ids={check:`km-route-c${index}`,to:`km-route-t${index}`,text:`km-route-x${index}`,tags:`km-route-g${index}`};
 const others=useMemo(()=>plan.recipients.filter(t=>!row.candidates.some(c=>c.threadId===t.threadId)),[plan.recipients,row.candidates]);
 const edited=state.text.trim()!==row.quote.trim();
 const tags:{text:string;tone:'warn'|'info'|'bad';hint?:string}[]=[];
 if(row.blocked)tags.push({text:tr("blocked_2")+row.blocked,tone:'bad'});
 if(!row.verbatim&&plan.origin!=='forward')tags.push({text:tr("paraphrased"),tone:'warn',hint:tr("this_text_wasn_t_found_in")});
 if(!row.blocked&&row.guessed&&state.threadId===row.threadId)tags.push({text:tr("check_recipient"),tone:'warn',hint:tr("recipient_inferred_from_keywords")});
 if(!row.blocked&&!state.threadId)tags.push({text:row.roleName?tr("has_no_open_thread_2", row.roleName):tr("recipient_unavailable"),tone:'warn'});
 if(target?.status==='working')tags.push({text:tr("thread_is_busy_message_will_queue"),tone:'info'});
 if(target?.status==='waiting')tags.push({text:tr("thread_is_waiting_for_your_answer"),tone:'info'});
 if(edited)tags.push({text:tr("text_edited"),tone:'info'});
 const off=!!row.blocked;
 return <li className={'km-route-row'+(off?' is-blocked':'')+(state.send&&!off?' is-on':'')}>
  <div className="km-route-who">
   <input id={ids.check} type="checkbox" checked={state.send&&!off} disabled={off||disabled||!state.threadId} onChange={e=>onChange({send:e.target.checked})} aria-describedby={ids.tags}/>
   <label htmlFor={ids.check} className="km-route-avatar">
    {target?<Sprite id={target.roleId} status={target.status} size={32} head/>:<span className="km-route-noone" aria-hidden="true">?</span>}
    <span className="km-route-name">{target?<><b>{target.name}</b> <span>{target.role}</span></>:<b>{off?tr("will_be_skipped"):row.roleName?tr("has_no_thread", row.roleName):tr("choose_a_recipient")}</b>}<span className="km-route-sr"> {tr("include")}</span></span>
   </label>
   {!off&&<>
    <label className="km-route-sr" htmlFor={ids.to}>{tr("recipient")} {index+1}</label>
    <select id={ids.to} value={state.threadId??''} disabled={disabled} onChange={e=>{const v=e.target.value||null;onChange({threadId:v,send:!!v});}}>
     <option value="">{tr("no_recipient")}</option>
     {row.candidates.length>0&&<optgroup label={tr("matching_roles")}>{row.candidates.map(t=><Opt key={t.threadId} t={t}/>)}</optgroup>}
     {others.length>0&&<optgroup label={tr("all_roles")}>{others.map(t=><Opt key={t.threadId} t={t}/>)}</optgroup>}
    </select>
   </>}
  </div>
  <div className="km-route-body">
   <label className="km-route-sr" htmlFor={ids.text}>{tr("excerpt")} {index+1}</label>
   <textarea id={ids.text} value={state.text} rows={Math.min(8,Math.max(2,state.text.split('\n').length+Math.floor(state.text.length/90)))} disabled={off||disabled} onChange={e=>onChange({text:e.target.value})}/>
   {row.note&&<p className="km-route-note">{tr("context")} {row.note}</p>}
   <p id={ids.tags} className="km-route-tags">
    {tags.map(t=><span key={t.text} className={'km-route-tag is-'+t.tone} title={t.hint}>{t.text}</span>)}
    {!off&&!state.threadId&&<button type="button" className="km-route-draft" disabled={disabled} onClick={()=>nav.toCompose({projectId:plan.projectId,initialPrompt:state.text,focusPrompt:true})}>{tr("open_a_new_draft_thread")}</button>}
   </p>
  </div>
 </li>;
}
function Opt({t}:{t:RouteTarget}){const lang=useLanguage();return <option value={t.threadId}>{`${t.name} · ${t.title.slice(0,48)} · ${statusText(t.status,lang)}`}</option>;}

/** Обёртка для слота pendingInteraction: payload это план из kv сервера. */
function FormSlot({interaction,submit,cancel}:{interaction:{payload:unknown};submit:(v:never)=>Promise<void>;cancel:()=>Promise<void>}){
 const tr=useText();
 const plan=interaction.payload as RoutePlan|null;
 if(!plan||!Array.isArray(plan.rows))return <div className="km km-route"><p role="alert">{tr("routing_plan_unavailable")}</p><button type="button" onClick={()=>void cancel()}>{tr("close")}</button></div>;
 return <RouteForm plan={plan} submit={v=>submit(v as never)} cancel={cancel}/>;
}

/** Журнал разносов треда: кому что ушло, переход в тред получателя. */
export function RouteLogList({threadId,limit=5}:{threadId:string;limit?:number}){
 const tr=useText();const lang=useLanguage();
 const rpc=useRpc<typeof routeRpcContract>();const nav=useBbNavigate();
 const [log,setLog]=useState<RouteLogEntry[]|null>(null);const tick=useRef<()=>void>(()=>{});
 useEffect(()=>{let alive=true;
  const read=()=>rpc.call('routeLog',{threadId}).then(l=>{if(alive)setLog(l as RouteLogEntry[]);}).catch(()=>{if(alive)setLog([]);});
  tick.current=()=>void read();void read();return()=>{alive=false;tick.current=()=>{};};},[rpc,threadId]);
 useRealtime(LOG_EVENT,(p:unknown)=>{if((p as {threadId?:string})?.threadId===threadId)tick.current();});
 if(!log||!log.length)return null;
 return <div className="km-route-log"><h3>{tr("routed_messages")}</h3><ul>
  {log.slice(0,limit).map(e=><li key={e.id}>
   <time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleString(lang,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>{' '}
   {e.outcome==='sent'?e.rows.filter(r=>r.delivery==='sent'||r.delivery==='queued').map(r=>
    <button key={r.index} type="button" className="km-route-link" onClick={()=>r.threadId&&nav.toThread(r.threadId)} title={r.text}>{r.name}{r.delivery==='queued'?tr("queued_2"):''}</button>)
   :<span>{e.outcome==='cancelled'?tr("unconfirmed"):e.outcome==='interrupted'?tr("interrupted"):tr("empty")}</span>}
   {e.rows.some(r=>r.delivery==='failed')&&<span className="km-route-tag is-bad">{tr("error")}</span>}
  </li>)}
 </ul></div>;
}

/** messageAction живёт вне React: RPC берём из оверлея, который всегда смонтирован. */
const rpcHandle:{current:((input:{threadId:string;role:'user'|'assistant';text:string;selectedText?:string})=>Promise<{started:boolean;error:string|null}>)|null}={current:null};
function RpcBridge(){
 const rpc=useRpc<typeof routeRpcContract>();
 useEffect(()=>{rpcHandle.current=i=>rpc.call('planRoute',i);return()=>{rpcHandle.current=null;};},[rpc]);
 return null;
}

/** Регистрация в app.tsx: форма, кнопка на сообщении, мост RPC для кнопки. */
export function registerRoute(app:PluginApp){
 const tr=text;
 app.slots.pendingInteraction({id:FORM_ID,component:FormSlot as never});
 app.slots.experimental_appOverlay({id:'route-rpc',component:RpcBridge});
 app.slots.messageAction({id:'route',title:tr("route_to_agents"),icon:'Split',run:async ctx=>{
  const call=rpcHandle.current;
  if(!call){console.warn(tr("cyber_office_route_rpc_not_ready"));return;}
  const r=await call({threadId:ctx.threadId,role:ctx.message.role,text:ctx.message.text,...(ctx.selectedText?{selectedText:ctx.selectedText}:{})});
  if(!r.started)console.warn(tr("cyber_office_route_could_not_open")+(r.error??''));
 }});
}
