import {useLanguage,useText} from './i18n-ui';
import {useEffect,useRef,useState} from 'react';
import {experimental_useCodeTheme,useBbNavigate,useRealtime,useRpc} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {groupPasses,parsePassDirective,passName,passTime,PASS_THREAD,PASS_EVENT} from './pass-display';
import type {ProjectPass} from './pass-log';
import {Sprite} from './ui';
import {useThreadCard} from './thread';
import './pass.css';

function Person({id,name}:{id:string;name?:string}){
 const lang=useLanguage();
 return <span className="km-pass-person">{id==='user'?<svg className="km-px" width="22" height="15" viewBox="0 0 20 13" shapeRendering="crispEdges" aria-hidden="true"><rect x="5" y="1" width="10" height="4" fill="#59483a"/><rect x="4" y="4" width="12" height="5" fill="#e6b88f"/><rect x="6" y="8" width="8" height="3" fill="#e6b88f"/><path d="M6 5h2v2H6zm6 0h2v2h-2z" fill="#292b35"/><rect x="8" y="9" width="4" height="1" fill="#965e53"/><rect x="5" y="11" width="10" height="2" fill="#4a76a8"/></svg>:<Sprite id={id.startsWith('shift:')?'stas':id} size={22} head/>}{name??passName(id,lang)}</span>;
}
export function TeamPassDirective({attributes,source}:{attributes:Readonly<Record<string,string>>;source:string}){
 const p=parsePassDirective(attributes);
 return p?<VerifiedPass key={p.thread} pass={p} source={source}/>:<code>{source}</code>;
}
function VerifiedPass({pass:p,source}:{pass:NonNullable<ReturnType<typeof parsePassDirective>>;source:string}){
 const tr=useText();
 const nav=useBbNavigate();const {card,failed}=useThreadCard(p.thread);
 let theme='dark';try{theme=experimental_useCodeTheme().mode;}catch{/* обычная тема */}
 if(failed||!card)return <code>{source}</code>;
 const ids=[p.from,...(p.via?[p.via]:[]),p.to];
 return <span className="km km-pass-inline" data-theme={theme}><button type="button" className="km-pass-line" onClick={()=>nav.toThread(p.thread)} title={tr("open_assignee_thread")}>
  {ids.map((id,i)=><span className="km-pass-hop" key={i}>{i>0&&<span aria-hidden="true">→</span>}<Person id={id} name={id===card.who.id?card.who.name:id===card.parent?.who?.id?card.parent.who.name:undefined}/></span>)}<span>· {p.task} · {p.at}</span>
 </button></span>;
}
const KINDS={dispatch:"handed_off",answer:"your_answer_3",shift:"shift_handoff_2",done:"done_2",review:"in_review_2"} as const;
export function PassList({passes,onThread,names}:{passes:ProjectPass[];onThread:(id:string)=>void;names?:ReadonlyMap<string,string>}){
 const tr=useText();const lang=useLanguage();
 if(!passes.length)return <p className="km-empty">{tr("no_handoffs_yet")}</p>;
 return <div className="km-passes">{groupPasses(passes).map(g=><section className="km-pass-task" key={JSON.stringify([g.boardId,g.task])}>
  <h2>{g.events[0].kind==='shift'?tr("shift_handoff_2"):g.task}</h2><ol>{g.events.map((e,i)=>{
   const clickable=!!e.threadId&&PASS_THREAD.test(e.threadId);
   return <li key={i}><div className="km-pass-line">
    {[e.from,e.to].map((id,n)=><span className="km-pass-hop" key={n}>{n>0&&<span aria-hidden="true">→</span>}{clickable?<button type="button" onClick={()=>onThread(e.threadId!)} title={tr("open_handoff_thread")}><Person id={id} name={names?.get(id)}/></button>:<Person id={id} name={names?.get(id)}/>}</span>)}
    <small>{tr(KINDS[e.kind])} · <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString(lang)}>{new Date(e.at).toLocaleDateString(lang)} · {passTime(e.at)}</time></small>
   </div></li>;
  })}</ol>
 </section>)}</div>;
}
/** Изолированная вкладка: RPC и подписка не нужны остальному офису и его превью. */
export function Passes({projectId,names}:{projectId:string;names?:ReadonlyMap<string,string>}){
 const tr=useText();
 const rpc=useRpc<typeof rpcContract>();const nav=useBbNavigate();
 const [passes,setPasses]=useState<ProjectPass[]>([]);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(true);
 const tick=useRef(()=>{});
 useEffect(()=>{
  let alive=true,busy=false,queued=false;
  const load=async()=>{
   if(busy){queued=true;return;}busy=true;
   try{const r=await rpc.call('getPasses',{projectId});if(alive){setPasses(r.passes);setError(null);}}
   catch(e){if(alive)setError(String(e));}
   finally{busy=false;if(alive){setLoading(false);if(queued){queued=false;void load();}}}
  };
  setPasses([]);setError(null);setLoading(true);tick.current=()=>void load();void load();const timer=setInterval(()=>void load(),30000);
  return()=>{alive=false;tick.current=()=>{};clearInterval(timer);};
 },[rpc,projectId]);
 useRealtime(PASS_EVENT,()=>tick.current());
 return <section aria-label={tr("handoffs")}>{error?<p className="km-error" role="alert">{tr("could_not_load_handoffs")} {error}</p>:loading?<p role="status">{tr("loading_handoffs")}</p>:<PassList passes={passes} names={names} onThread={id=>nav.toThread(id)}/>}</section>;
}
