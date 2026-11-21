import {useText,useLanguage} from './i18n-ui';
import {useEffect,useRef,useState} from 'react';
import {experimental_useCodeTheme,useBbNavigate,useRealtime,useRpc} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {statusText,type TeamStatus} from './model';
import {Sprite,cleanTitle} from './ui';
import {RouteLogList} from './route-form';
import {guard} from './compat-app';

/** Журнал разносов в блоке «Cyber Office»: падение журнала не трогает остальной блок. */
const RouteLog=guard('route',RouteLogList);

/** What the thread view shows: who works here, who gets the result, what was delegated. */
export interface ThreadCard {
 thread:{id:string;title:string|null};status:TeamStatus;
 who:{id:string;name:string;role:string;intern?:boolean};
 handoff:{id:string;name:string;role:string}|null;
 parent:{id:string;title:string|null;who:{id:string;name:string}|null}|null;
 children:{thread:{id:string;title:string|null};status:TeamStatus;who:{id:string;name:string;role:string}}[];
}

function useTheme(){try{return experimental_useCodeTheme().mode==='light'?'light':'dark';}catch{return 'dark';}}
const THREAD_ID=/^thr_[a-z0-9]{4,40}$/;

export function useThreadCard(threadId:string|null){
 const rpc=useRpc<typeof rpcContract>();
 const [card,setCard]=useState<ThreadCard|null>(null);const [failed,setFailed]=useState(false);
 const tick=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let alive=true;
  const load=()=>{if(!threadId||!THREAD_ID.test(threadId))return;rpc.call('getThreadCard',{threadId}).then(c=>{if(alive){setCard(c as ThreadCard|null);setFailed(false);}}).catch(()=>{if(alive)setFailed(true);});};
  tick.current=load;load();
  return()=>{alive=false;tick.current=()=>{};};
 },[rpc,threadId]);
 useRealtime('threads-changed',()=>tick.current());
 useRealtime('roles-changed',()=>tick.current());
 useRealtime('language-changed',()=>tick.current());
 return {card,failed};
}

const DOT:Record<TeamStatus,string>={waiting:'!',error:'×',working:'●',delivered:'✉',free:'·'};

/** Body of the «Cyber Office» section in the thread context card and the Info tab. */
export function ThreadTeam({threadId}:{threadId:string}){
 const tr=useText();const lang=useLanguage();
 const nav=useBbNavigate();const theme=useTheme();const {card}=useThreadCard(threadId);
 if(!card)return null;
 return <div className="km km-tc" data-theme={theme}>
  <div className="km-tc-me"><Sprite id={card.who.id} status={card.status} size={30} head/><span><b>{card.who.name}</b> <small>{card.who.role} · {statusText(card.status,lang)}</small></span></div>
  {card.handoff&&<button className="km-tc-row" disabled={!card.parent} onClick={()=>card.parent&&nav.toThread(card.parent.id)} title={card.parent?tr("open_the_thread_that_receives_this"):card.handoff.id==='user'?tr("handed_directly_to_you"):tr("handed_off_according_to_the_role")}>
   <small>{tr("hands_off_to_3")}</small>{card.handoff.id==='user'?<span>{tr("you_3")}</span>:<><Sprite id={card.handoff.id} size={20} head/><span>{card.handoff.name}{card.parent?': '+cleanTitle(card.parent.title,lang):''}</span></>}
  </button>}
  {card.children.length>0&&<><h4>{tr("delegated")} {card.children.length}</h4>
   {card.children.map(c=><button key={c.thread.id} className="km-tc-row" onClick={()=>nav.toThread(c.thread.id)} title={tr("open_thread_2")}>
    <Sprite id={c.who.id} status={c.status} size={20} head/><span><b>{c.who.name}</b> {cleanTitle(c.thread.title,lang)}</span><small>{DOT[c.status]} {statusText(c.status,lang)}</small>
   </button>)}</>}
  <RouteLog threadId={threadId}/>
 </div>;
}

/** `::team-thread{id="thr_…"}` in a coordinator reply: a card that jumps to the delegated thread. */
export function TeamThreadDirective({attributes,source}:{attributes:Readonly<Record<string,string>>;source:string}){
 const tr=useText();const lang=useLanguage();
 const nav=useBbNavigate();const theme=useTheme();
 const id=attributes.id??'';const valid=THREAD_ID.test(id);
 const {card,failed}=useThreadCard(valid?id:null);
 if(!valid||failed)return <code>{source}</code>;
 const s=card?.status??'free';
 return <span className="km" data-theme={theme} style={{display:'inline',padding:0,background:'transparent',minHeight:0}}>
  <button className={'km-dir is-'+s} onClick={()=>nav.toThread(id)} aria-label={card?tr("open_thread_for", card.who.name, cleanTitle(card.thread.title,lang)):tr("open_thread_2")}>
   {card?<Sprite id={card.who.id} status={s} size={30} head/>:null}
   <span className="km-dir-text"><b>{card?`${card.who.name} · ${card.who.role}`:tr("thread_2")}</b><small>{card?cleanTitle(card.thread.title,lang):id} · {statusText(s,lang)}</small></span>
  </button>
 </span>;
}

/** Chip in the context row above the composer: who works here, and how many threads were delegated. */
export function TeamSegmentSummary({threadId,isExpanded,onToggle}:{threadId:string;isExpanded:boolean;onToggle:()=>void}){
 const tr=useText();const lang=useLanguage();
 const theme=useTheme();const {card}=useThreadCard(threadId);
 if(!card)return null;
 const n=card.children.length;
 return <span className="km km-seg-chip" data-theme={theme}>
  <button onClick={onToggle} aria-expanded={isExpanded} title={n?tr("show_delegated_threads"):tr("who_works_in_this_thread")}>
   <Sprite id={card.who.id} status={card.status} size={18} head/><b>{card.who.name}</b>
   {card.handoff&&<small>→ {card.handoff.name}</small>}{n>0&&<small>{tr("delegated_2")} {n}</small>}
  </button>
 </span>;
}
export function TeamSegmentDetails({threadId,isExpanded}:{threadId:string;isExpanded:boolean}){
 if(!isExpanded)return null;
 return <div style={{padding:'6px 10px'}}><ThreadTeam threadId={threadId}/></div>;
}
