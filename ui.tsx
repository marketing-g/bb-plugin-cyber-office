import {useText,useLanguage} from './i18n-ui';
import {DEFAULT_LANGUAGE,dataText,languageOf,translator,type Language,type MessageKey} from './i18n.ts';
import {LOOK_SETS,type LookSet} from './kiborgi';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type ComponentType} from 'react';
import {EFFORTS,MODEL_CATALOG,customRole,roleInputError,statusText,askLink,roleSteps,statusRank,stepLink,threadStatus,type Brains,type LinkTarget,type Role,type RolePatch,type RoleSummary,type Thread,type TeamStatus} from './model';
import {officePropRuns,propRuns,spriteRuns,type OfficeProp,type SpriteStyle} from './sprites';
import builtinRoster from './team.json';
import {PlainField,type FieldComponent} from './field';
import {WaitingAge,waitingRailStatus,extraWaiting,ForemanWaitingRows} from './foreman-ui';
import type {WaitingItem} from './foreman';
import {DEFAULT_STAGE,DEMO_STEPS,DEMO_STEP_MS,DEMO_TASK,FLOW_ORDER,STAGES,demoTeam,liveFlows,restNote,stageTeam,type QueueRow,type StageId} from './flow';
import {SHOW_STEPS,SHOW_TASK,nameOf,showFlow,showProgress,showTeam,type ShowRun} from './show';
import {RolePicker,toolLabel,type PickerKind,type LoadSkillCatalog} from './role-picker';
import type {CatalogSkill} from './skill-categories';
import {SHIFT_LIMIT} from './board';

export interface Step {id:string;title:string;role?:string;output?:string;needsUser?:boolean;children?:Step[];steps?:Step[]}
export interface TeamViewData {team:RoleSummary[];interns:RoleSummary[];waiting:number;fetchedAt:number;coordinatorThreadId?:string|null;waitingSummary?:WaitingItem[]|null}
/** Строка доски Стаса, как её отдаёт RPC getBoards. */
export interface BoardRowView {id:string;task:string;roleId:string;status:string;threadId:string|null;invalidThread?:boolean;updatedAt:number;note?:string;live?:{status:string;title:string|null;pending:boolean;archived:boolean}|null}
export interface BoardView {id:string;title:string;primary:boolean;currentThreadId:string;shifts:string[];rows:BoardRowView[];handoff?:{from:string;to:string|null;note:string;at:number;usage:number|null}|null;shiftBlockedUntil?:number;updatedAt:number;config?:{handoffAt:number;handoffTurns:number};mirror?:string|null}
export type Tab='team'|'schema'|'chains'|'passes'|'settings';
const SpriteStyles=createContext<ReadonlyMap<string,Role>>(new Map());
/** Everyone on the board by id: roles and interns. */
export function peopleOf(data:TeamViewData){return new Map([...data.team,...data.interns].map(r=>[r.id,r]));}
export function Who({id,people,size=20}:{id:string;people:Map<string,RoleSummary>;size?:number}){
 const tr=useText();const lang=useLanguage();
 if(id==='user')return <span className="km-who"><span className="km-who-user" style={{width:size,height:size}} aria-hidden="true">{tr("y")}</span>{tr("you")}</span>;
 const r=people.get(id);if(!r)return null;
 return <span className="km-who"><Sprite id={r.id} status={r.status} size={size} head/>{r.name}</span>;
}
export type Theme='dark'|'light';
export interface TeamActions {
 PassesPanel?:ComponentType<{projectId:string;names?:ReadonlyMap<string,string>}>;
 onThread:(id:string)=>void;
 /** Send a task to the coordinator. Resolves with a short human result. */
 onSendTask?:(text:string)=>Promise<string>;
 /** Поле задачи в пульте Стаса. В BB поле с микрофоном (voice-field.tsx), в превью обычное. */
 TaskField?:FieldComponent;
 /** Настоящий прогон для гостей: состояние и кнопки. Нет в превью без сервера. */
 show?:ShowControl;
 onSaveRole?:(roleId:string|null,patch:RolePatch)=>Promise<void>;
 onResetRole?:(roleId:string)=>Promise<void>;
 onDeleteRole?:(roleId:string)=>Promise<void>;
 loadSkills?:LoadSkillCatalog;
}

const THINK=['ada','sherlock','mark','radar','nora','sema'];
const MAKE=['pixel','kadr','bolt','rams','tara'];
const STATUS_ICON:Record<TeamStatus,string>={waiting:'!',error:'×',working:'●',delivered:'✉',free:'z'};

/* ---------- pixel sprites ---------- */
export function Sprite({id,status='working',size=64,head=false,className='',appearance}:{id:string;status?:TeamStatus;size?:number;head?:boolean;className?:string;appearance?:SpriteStyle}){
 const styles=useContext(SpriteStyles);
 const style=appearance??styles.get(id);
 const rows=head?13:20;
 return <svg className={'km-px '+className} width={size} height={size*rows/20} viewBox={`0 0 20 ${rows}`} shapeRendering="crispEdges" aria-hidden="true">
  {spriteRuns(id,status==='free'?'free':'working',rows,style).map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}
 </svg>;
}

function Screen({status}:{status:TeamStatus}){
 return <g className={'km-scr km-scr-'+status}><ScreenFace status={status}/></g>;
}
function ScreenFace({status}:{status:TeamStatus}){
 // 10 x 8 monitor screen at (31,11)
 const R=(x:number,y:number,w:number,h:number,f:string)=><rect x={x} y={y} width={w} height={h} fill={f}/>;
 if(status==='working')return <g>{R(31,11,10,8,'#0f2a22')}<g className="km-code">{R(32,12,5,1,'#3ddc84')}{R(33,14,6,1,'#3ddc84')}{R(33,16,3,1,'#9dffc9')}{R(32,17,6,1,'#3ddc84')}</g><g className="km-code km-code-b">{R(32,12,7,1,'#3ddc84')}{R(32,14,4,1,'#9dffc9')}{R(33,16,6,1,'#3ddc84')}{R(33,17,2,1,'#3ddc84')}</g></g>;
 if(status==='waiting')return <g className="km-scr-blink">{R(31,11,10,8,'#ffb020')}{R(35,12,2,4,'#3a2600')}{R(35,17,2,1,'#3a2600')}</g>;
 if(status==='error')return <g>{R(31,11,10,8,'#7a1820')}{R(33,12,2,2,'#ff8a8a')}{R(37,12,2,2,'#ff8a8a')}{R(35,14,2,2,'#ff8a8a')}{R(33,16,2,2,'#ff8a8a')}{R(37,16,2,2,'#ff8a8a')}</g>;
 if(status==='delivered')return <g>{R(31,11,10,8,'#123257')}{R(32,15,2,2,'#7cc4ff')}{R(34,16,2,2,'#7cc4ff')}{R(36,14,2,2,'#7cc4ff')}{R(38,12,2,2,'#7cc4ff')}</g>;
 return R(31,11,10,8,'#15171f');
}

function Desk({id,status='free'}:{id?:string;status?:TeamStatus}){
 const style=useContext(SpriteStyles).get(id??'');
 const skin=id?spriteRuns(id,'working',undefined,style).find(r=>r.y===9)?.fill:undefined;
 return <svg className="km-desk" viewBox="0 0 42 36" shapeRendering="crispEdges" aria-hidden="true">
  <rect x="3" y="34" width="36" height="2" fill="rgba(0,0,0,.28)"/>
  <rect x="9" y="9" width="24" height="15" fill="#1d1b26"/><rect x="10" y="10" width="22" height="13" fill="var(--km-chair)"/><rect x="10" y="10" width="22" height="2" fill="var(--km-chair-hi)"/>
  {id&&<><g transform="translate(11 3)">{spriteRuns(id,status==='free'?'free':'working',undefined,style).map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}</g>
  <rect x="30" y="10" width="12" height="10" fill="#1d1b26"/><Screen status={status}/><rect x="35" y="20" width="2" height="2" fill="#1d1b26"/><rect x="33" y="21" width="6" height="1" fill="#1d1b26"/>
  </>}
  <rect x="0" y="22" width="42" height="12" fill="#1d1b26"/><rect x="1" y="22" width="40" height="3" fill="var(--km-desk-top)"/><rect x="1" y="25" width="40" height="1" fill="var(--km-desk-edge)"/><rect x="1" y="26" width="40" height="7" fill="var(--km-desk)"/>
  <rect x="27" y="27" width="11" height="4" fill="var(--km-desk-edge)"/><rect x="31" y="29" width="3" height="1" fill="#1d1b26"/>
  {id?<><rect className={'km-led km-led-'+status} x="4" y="28" width="4" height="2"/>
  <rect x="13" y="20" width="15" height="2" fill="#1d1b26"/><rect x="14" y="20" width="13" height="1" fill="#9aa6b8"/>
  <g className={status==='working'?'km-hands':''}><rect className="km-hand-l" x="15" y="19" width="3" height="2" fill={skin}/><rect className="km-hand-r" x="23" y="19" width="3" height="2" fill={skin}/></g>
  <g transform="translate(1 14)">{propRuns(style?.avatar??id).map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}</g>
  </>:<path className="km-add-cross" d="M19 7h4v6h6v4h-6v6h-4v-6h-6v-4h6z"/>}
 </svg>;
}

export function cleanTitle(t?:string|null,lang=DEFAULT_LANGUAGE){
 const tr=translator(lang);return (t||'').replace(/^\[[^\]]+\]\s*/,'').replace(/^(?:Показ|Demo):\s*/i,'')||tr("untitled");}
/**
 * Звено, вопрос или тред: кнопка, если тред есть, иначе текст без руки-курсора
 * с подсказкой, почему не открывается. Подсказку читает и скринридер.
 */
export function ThreadLink({link,onThread,className='',label,children}:{link:LinkTarget;onThread?:(id:string)=>void;className?:string;label?:string;children:ReactNode}){
 const id=link.threadId;
 if(id&&onThread)return <button type="button" className={'km-tl '+className} onClick={()=>onThread(id)} title={link.why} aria-label={label?`${label}. ${link.why}`:undefined}>{children}</button>;
 return <span className={'km-tl is-off '+className} title={link.why}>{children}<span className="km-sr">. {link.why}</span></span>;
}
function pendingThread(r:RoleSummary){return r.threads.find(t=>t.hasPendingInteraction)??null;}
function threadWith(r:RoleSummary,s:TeamStatus){return r.threads.find(t=>threadStatus(t)===s)??null;}

function Bubble({role,onThread}:{role:RoleSummary;onThread:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 const s=role.status;
 if(s==='waiting'){const t=pendingThread(role);return <button className="km-bubble km-bubble-waiting" aria-label={tr("is_waiting_for_you_open_thread", role.name)} title={t?tr("open_question_thread"):tr("question_thread_unavailable")} disabled={!t} onClick={()=>t&&onThread(t.id)}>!</button>;}
 if(s==='delivered'){const t=threadWith(role,'delivered');return <button className="km-bubble km-bubble-delivered" aria-label={tr("delivered_work_open_thread", role.name)} title={t?tr("review_delivered_work"):tr("thread_unavailable")} disabled={!t} onClick={()=>t&&onThread(t.id)}><Envelope/></button>;}
 if(s==='error'){const t=threadWith(role,'error');return <button className="km-bubble km-bubble-error" aria-label={tr("hit_an_error_open_thread", role.name)} title={t?tr("open_thread_with_error"):tr("thread_unavailable")} disabled={!t} onClick={()=>t&&onThread(t.id)}>×</button>;}
 if(s==='working')return <span className="km-bubble km-bubble-working" aria-hidden="true"><i/><i/><i/></span>;
 return <span className="km-zzz" aria-hidden="true">z<small>z</small></span>;
}
function Envelope(){return <svg width="22" height="16" viewBox="0 0 11 8" shapeRendering="crispEdges" aria-hidden="true"><rect width="11" height="8" fill="#1d1b26"/><rect x="1" y="1" width="9" height="6" fill="#f4f1ea"/><rect x="2" y="2" width="1" height="1" fill="#1d1b26"/><rect x="3" y="3" width="1" height="1" fill="#1d1b26"/><rect x="4" y="4" width="3" height="1" fill="#1d1b26"/><rect x="7" y="3" width="1" height="1" fill="#1d1b26"/><rect x="8" y="2" width="1" height="1" fill="#1d1b26"/></svg>;}

function Handoff({role,people}:{role:RoleSummary;people:Map<string,RoleSummary>}){
 const tr=useText();const lang=useLanguage();
 const to=role.current?.handoffTo;if(!to)return null;const sent=role.status==='delivered';
 return <span className={'km-handoff'+(sent?' is-sent':'')}><i aria-hidden="true">{sent?<Envelope/>:'→'}</i>{sent?tr("delivered_to"):tr("hands_off_to")}<Who id={to} people={people} size={18}/></span>;
}
function Station({role,people,onOpen,onThread,filter=null,queue=[]}:{role:RoleSummary;people:Map<string,RoleSummary>;onOpen:(id:string,el:HTMLElement)=>void;onThread:(id:string)=>void;filter?:TeamStatus|null;queue?:QueueRow[]}){
 const tr=useText();const lang=useLanguage();
 const task=role.current?.title;
 const hit=!filter||role.threads.some(t=>threadStatus(t)===filter);
 const rest=restNote(role,queue,lang);
 const plateStatus=role.status==='free'?tr("resting"):statusText(role.status,lang);
 return <article className={'km-st km-st-'+role.status+(role.intern?' km-st-intern':'')+(hit?'':' is-dim')} data-role={role.intern?'intern':role.id}>
  <div className="km-st-scene">
   <span className="km-beam" aria-hidden="true"/>
   <Bubble role={role} onThread={onThread}/>
   <button className="km-st-hit" aria-label={tr("role_card_for", role.name, role.role, statusText(role.status,lang))} onClick={e=>onOpen(role.id,e.currentTarget)}><Desk id={role.id} status={role.status}/></button>
  </div>
  <div className="km-plate">
   <button type="button" className="km-plate-open" onClick={e=>onOpen(role.id,e.currentTarget)} tabIndex={-1} aria-hidden="true">
    <span className="km-plate-name">{role.name}{role.customized&&<em title={tr("customized")}>★</em>}</span>
    <span className="km-plate-role">{role.role}</span>
    <span className={'km-pill km-pill-'+role.status}><b>{STATUS_ICON[role.status]}</b>{plateStatus}</span>
   </button>
   {rest?<ThreadLink className="km-plate-task km-rest" link={role.current?{threadId:role.current.id,status:role.status,why:tr("open_task_thread")}:{threadId:null,status:null,why:tr("has_no_open_thread", role.name)}} onThread={onThread} label={`${role.name}: ${rest.label} ${rest.text}`}><b>{rest.label}:</b> {rest.text}</ThreadLink>
   :<ThreadLink className="km-plate-task" link={role.current?{threadId:role.current.id,status:role.status,why:tr("open_task_thread")}:{threadId:null,status:null,why:tr("has_no_open_thread", role.name)}} onThread={onThread} label={`${role.name}: ${task?cleanTitle(task,lang):tr("no_task")}`}>{task?cleanTitle(task,lang):tr("no_task_2")}{role.threads.length>1?tr("more", role.threads.length-1):''}</ThreadLink>}
   {role.status!=='free'&&<Handoff role={role} people={people}/>}
  </div>
 </article>;
}

function DeskRows({children}:{children:ReactNode[]}){
 const seatsPerRow=5;
 return <div className="km-row">{Array.from({length:Math.ceil(children.length/seatsPerRow)},(_,i)=>
  <div key={i} className="km-desk-row">{children.slice(i*seatsPerRow,(i+1)*seatsPerRow)}</div>)}</div>;
}

/* ---------- Stas console ---------- */
const COUNTERS:{s:TeamStatus;label:MessageKey}[]=[{s:'waiting',label:"waiting_for_you"},{s:'working',label:"working"},{s:'delivered',label:"delivered"},{s:'error',label:"errors"}];
function StasConsole({role,counts,coordinatorThreadId,projectName,onSendTask,TaskField=PlainField,onThread,onBoard,filter,onFilter,demo,onDemo,show}:{role:RoleSummary;counts:Record<TeamStatus,number>;coordinatorThreadId:string|null;projectName?:string;onSendTask?:(t:string)=>Promise<string>;TaskField?:FieldComponent;onThread:(id:string)=>void;onBoard?:(el:HTMLElement)=>void;filter:TeamStatus|null;onFilter:(s:TeamStatus|null)=>void;demo:boolean;onDemo:()=>void;show?:ShowControl}){
 const tr=useText();const lang=useLanguage();
 const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [note,setNote]=useState<string|null>(null);const [voice,setVoice]=useState(false);
 // Пока идёт запись или расшифровка, не отправляем: текст ещё допишется.
 const submit=async()=>{const t=text.trim();if(!t||!onSendTask||voice)return;setBusy(true);setNote(null);try{setNote(await onSendTask(t));setText('');}catch(e){setNote(tr("could_not_send")+String((e as Error)?.message??e));}finally{setBusy(false);}};
 return <section className={'km-console km-st-'+role.status} aria-label={tr("stas_s_desk")}>
  <div className="km-console-scene">
   <Bubble role={role} onThread={onThread}/>
   <button className="km-st-hit" aria-label={tr("open_desk_for")+role.name} title={role.name} onClick={e=>onBoard?.(e.currentTarget)}>
    <svg className="km-console-art" viewBox="0 0 72 44" shapeRendering="crispEdges" aria-hidden="true">
     <rect x="2" y="2" width="68" height="20" fill="#1d1b26"/>
     {[0,1,2].map(i=><g key={i}><rect x={4+i*22} y="4" width="20" height="16" fill="#0b2233"/><rect className={'km-holo km-holo-'+i} x={6+i*22} y={14-i*3} width={4} height={4+i*3} fill="#5ff3ff"/><rect className={'km-holo km-holo-'+((i+1)%3)} x={11+i*22} y={10} width={4} height={8} fill="#2fb7d6"/><rect className="km-holo" x={16+i*22} y={12+i} width={2} height={6-i} fill="#9ffbff"/></g>)}
     <g transform="translate(26 6)">{spriteRuns('stas',role.status==='free'?'free':'working',undefined,role).map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}</g>
     <rect x="0" y="25" width="72" height="19" fill="#1d1b26"/><rect x="1" y="25" width="70" height="4" fill="#4a5a7a"/><rect x="1" y="29" width="70" height="14" fill="#33405a"/>
     {Array.from({length:12},(_,i)=><rect key={i} className={'km-btn km-btn-'+(i%4)} x={5+i*5.5} y="26" width="3" height="2" fill={['#ff5a5a','#ffb020','#3ddc84','#59a8ff'][i%4]}/>)}
     <rect x="24" y="33" width="24" height="6" fill="#1d1b26"/><rect x="25" y="34" width="22" height="4" fill="#5ff3ff" className="km-holo"/>
    </svg>
   </button>
  </div>
  <div className="km-console-panel">
   <div className="km-console-head"><div><h2><button type="button" className="km-link km-console-name" onClick={e=>onBoard?.(e.currentTarget)}>{role.name}</button>{show&&<ShowButton show={show}/>}<button type="button" className={'km-demo-btn'+(show?.here?' km-demo-btn-ghost':'')+(demo?' is-on':'')} onClick={onDemo} aria-pressed={demo} title={demo?tr("stop_animation"):tr("watch_a_sample_workflow_offline_with")}>{demo?tr("stop"):show?.here?tr("offline_demo"):tr("test_run")}</button></h2><p>{tr("give_the_coordinator_a_task_to")}</p></div>
    <div className="km-counts" role="group" aria-label={tr("filter_office_by_status")}>{COUNTERS.map(c=><button key={c.s} type="button" className={'km-c-'+c.s} aria-pressed={filter===c.s} title={filter===c.s?tr("clear_filter"):tr("show_only", tr(c.label).toLowerCase())} onClick={()=>onFilter(filter===c.s?null:c.s)}><span>{tr(c.label)}</span><b>{counts[c.s]}</b></button>)}</div></div>
   <form className="km-ask" onSubmit={e=>{e.preventDefault();void submit();}}>
    <label className="km-sr" htmlFor="km-task">{tr("task_for_stas")}</label>
    <TaskField id="km-task" className="km-task" value={text} rows={2} placeholder={tr("try_draft_three_slides_for_the")} onValueChange={setText} onVoiceInputActiveChange={setVoice} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void submit();}}}/>
    <div className="km-ask-row">
     <button type="submit" className="km-btn-primary" disabled={busy||voice||!text.trim()}>{busy?tr("sending"):voice?tr("recording"):tr("send_to_coordinator")}</button>
     {coordinatorThreadId&&<button type="button" className="km-btn-ghost" onClick={()=>onThread(coordinatorThreadId)}>{tr("open_coordinator_thread")}</button>}
     <span className="km-hint">{note??(projectName?tr("sends_to_the_coordinator_for", projectName):coordinatorThreadId?tr("ctrl_enter_sends_to_the_coordinator"):tr("this_will_create_a_new_coordinator"))}</span>
    </div>
   </form>
  </div>
 </section>;
}

/* ---------- Shepherd-style rail ---------- */
interface RailItem {t:Thread;role:RoleSummary;status:TeamStatus}
function railItems(data:TeamViewData):RailItem[]{
 const items:RailItem[]=[...data.team,...data.interns].flatMap(r=>r.threads.map(t=>({t,role:r,status:waitingRailStatus(t.id,data.waitingSummary,threadStatus(t))})));
 return items.sort((a,b)=>statusRank(a.status)-statusRank(b.status));
}
const RAIL_GROUPS:{s:TeamStatus;title:MessageKey;action:MessageKey}[]=[{s:'waiting',title:"waiting_for_you",action:"answer"},{s:'error',title:"errors",action:"inspect"},{s:'delivered',title:"delivered_check_it",action:"review"},{s:'working',title:"working",action:"view"},{s:'free',title:"quiet",action:"open"}];
export function Rail({data,onThread,compact=false,filter=null}:{data:TeamViewData;onThread:(id:string)=>void;compact?:boolean;filter?:TeamStatus|null}){
 const tr=useText();const lang=useLanguage();
 const items=railItems(data);const people=peopleOf(data);
 const extra=extraWaiting(data.waitingSummary,items.map(x=>x.t.id));
 const groups=RAIL_GROUPS.filter(g=>filter?g.s===filter:!compact||g.s==='waiting');
 return <nav className="km-rail" aria-label={tr("team_tasks")}>
  {groups.map(g=>{const list=items.filter(i=>i.status===g.s);if(!list.length&&g.s!=='waiting'&&g.s!==filter)return null;return <section key={g.s} className={'km-rail-g km-rail-'+g.s}>
   <h2><span>{tr(g.title)}</span><b>{list.length+(g.s==='waiting'?extra.length:0)}</b></h2>
   {list.length?<ul>{list.map(({t,role})=><li key={t.id}><button onClick={()=>onThread(t.id)} title={tr("open_thread")}>
    <Sprite id={role.id} status={g.s} size={30} head/>
    <span className="km-rail-text"><b>{role.name}{role.intern&&<em> {tr("intern")}</em>}{t.handoffTo&&<em> → {t.handoffTo==='user'?tr("you_2"):people.get(t.handoffTo)?.name}</em>}</b><small>{cleanTitle(t.title,lang)}</small><WaitingAge threadId={t.id} items={data.waitingSummary}/></span>
    <i>{tr(g.action)}</i></button></li>)}</ul>:g.s==='waiting'&&extra.length?null:<p className="km-rail-empty">{g.s==='waiting'?tr("no_one_needs_an_answer"):tr("nothing_here")}</p>}
   {g.s==='waiting'&&<ForemanWaitingRows rows={extra} onThread={onThread}/>}
  </section>;})}
 </nav>;
}
export function Waiting({data,onThread}:{data:TeamViewData;onThread:(id:string)=>void}){return <Rail data={data} onThread={onThread} compact/>;}

/* ---------- cyborg card ---------- */
const providerShort=(b:Brains)=>b.providerId==='codex'||/openai|codex/i.test(b.provider)?'Codex':'Claude';
function EffortMeter({effort}:{effort:string}){
 const tr=useText();const lang=useLanguage();
 const i=EFFORTS.indexOf(effort as typeof EFFORTS[number]);
 if(i<0)return <span className="km-meter"><b>{tr("uses_the_default_effort")}</b></span>;
 return <span className="km-meter" aria-label={tr("effort")+effort}>{EFFORTS.map((e,k)=><i key={e} className={k<=i?'on':''}/>)}<b>{effort}</b></span>;
}
function Chips({items,onRemove}:{items:string[];onRemove?:(i:number)=>void}){
 const tr=useText();
 return <ul className="km-chips">{items.map((x,i)=><li key={`${i}-${x}`}>{x}{onRemove&&<button type="button" aria-label={tr("remove")+x} onClick={()=>onRemove(i)}>×</button>}</li>)}</ul>;
}
function Module({title,icon,children,className=''}:{title:string;icon:string;children:ReactNode;className?:string}){
 return <section className={'km-mod '+className}><h3><span className="km-mod-ico" aria-hidden="true">{icon}</span>{title}</h3>{children}</section>;
}
function PeopleLine({names,team}:{names:string[];team:RoleSummary[]}){
 const tr=useText();const lang=useLanguage();
 return <ul className="km-people">{names.map(n=>{const r=team.find(x=>x.name===n);return <li key={n}>{r?<Sprite id={r.id} size={26} head/>:<span className="km-rail-noface" aria-hidden="true">{/^(you|вы)$/i.test(n)?tr("y"):'∗'}</span>}{n}</li>;})}</ul>;
}

function CyborgCard({role,team,blocks,onClose,onThread,onSaveRole,onResetRole,onDeleteRole,loadSkills,initialSkills,initialPicker=null,initialEdit=false,creating=false}:{
 initialEdit?:boolean;initialPicker?:PickerKind|null;initialSkills?:CatalogSkill[];creating?:boolean;role:RoleSummary;team:RoleSummary[];blocks:Step[];onClose:()=>void;
}&TeamActions){
 const tr=useText();const lang=useLanguage();
 const [edit,setEdit]=useState(initialEdit||!!initialPicker);const [busy,setBusy]=useState(false);const [err,setErr]=useState<string|null>(null);
 const [picker,setPicker]=useState<PickerKind|null>(initialPicker);
 const toolsButton=useRef<HTMLButtonElement>(null);
 const skillsButton=useRef<HTMLButtonElement>(null);
 const returnFocus=useRef<PickerKind|null>(null);
 const [name,setName]=useState(role.name);const [look,setLook]=useState<LookSet>(role.look??'b');const [glow,setGlow]=useState(role.glow??'#61eaff');
 const [brains,setBrains]=useState<Brains>(role.brains);const [hands,setHands]=useState(role.hands);const [skills,setSkills]=useState(role.skills);
 const [position,setPosition]=useState(role.role);const [stage,setStage]=useState(role.stage??DEFAULT_STAGE);
 const [avatar,setAvatar]=useState(role.avatar??'intern0');const [callsUser,setCallsUser]=useState(role.callsUser);
 const restore=()=>{setName(role.name);setLook(role.look??'b');setGlow(role.glow??'#61eaff');setBrains(role.brains);setHands(role.hands);setSkills(role.skills);
  setPosition(role.role);setStage(role.stage??DEFAULT_STAGE);setAvatar(role.avatar??'intern0');setCallsUser(role.callsUser);};
 const dlg=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(picker)return;
  const trigger=returnFocus.current==='tools'?toolsButton:returnFocus.current==='skills'?skillsButton:dlg;
  trigger.current?.focus();
  returnFocus.current=null;
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
  document.addEventListener('keydown',key);
  return()=>document.removeEventListener('keydown',key);
 },[onClose,picker]);
 const openPicker=(kind:PickerKind)=>{
  if(!edit){restore();setEdit(true);}
  setPicker(kind);
 };
 const closePicker=()=>{returnFocus.current=picker;setPicker(null);};
 const steps=useMemo(()=>roleSteps(blocks,role.id),[blocks,role.id]);
 const e=role.current?.execution;
 const modelValue=brains.modelId?`${brains.providerId}|${brains.modelId}`:'';
 const pickModel=(v:string)=>{const [pid,mid]=v.split('|');const p=MODEL_CATALOG.find(x=>x.providerId===pid);const m=p?.models.find(x=>x.id===mid);if(p&&m)setBrains({...brains,provider:p.provider,providerId:p.providerId,model:m.name,modelId:m.id});};
 const save=async()=>{
  if(!onSaveRole)return;
  const issue=roleInputError({...role,name,role:position},[]);
  if(issue){setErr(tr(issue));return;}
  setBusy(true);setErr(null);
  try{
   await onSaveRole(creating?null:role.id,{...(creating||name!==role.name?{name}:{}),look,glow,brains,...(hands!==role.hands?{hands}:{}),skills,
    ...(role.custom?{role:position,stage,avatar,callsUser}:{})});
   if(creating)onClose();else setEdit(false);
  }catch(x){setErr(String((x as Error)?.message??x));}finally{setBusy(false);}
 };
 const change=async(action:((id:string)=>Promise<void>)|undefined,done:()=>void)=>{
  if(!action)return;
  setBusy(true);setErr(null);
  try{await action(role.id);done();}catch(x){setErr(String((x as Error)?.message??x));}finally{setBusy(false);}
 };
 const appearance=role.custom&&edit?{avatar,look,glow}:undefined;
 return <div className="km-backdrop" onMouseDown={ev=>{if(ev.target===ev.currentTarget)(picker?closePicker:onClose)();}}>
  <section ref={dlg} tabIndex={-1} inert={!!picker} className={'km-cyborg km-st-'+role.status} role="dialog" aria-modal={picker?undefined:true} aria-label={creating?tr('add_agent'):tr("role_card_for_2")+role.name}>
   <button className="km-close" onClick={onClose} aria-label={tr("close_role_card")}>×</button>
   <div className="km-cy-left">
    <div className="km-pedestal"><Sprite id={role.id} status={role.status} size={176} appearance={appearance}/><div className="km-pedestal-base" aria-hidden="true"/></div>
    <h2>{creating?tr('add_agent'):role.name}{!creating&&role.custom&&<em className="km-custom">{tr('agent_custom')}</em>}{!role.custom&&role.customized&&<em className="km-custom">{tr("customized_2")}</em>}</h2>
    <p className="km-cy-role">{role.role}</p>
    <span className={'km-pill km-pill-'+role.status}><b>{STATUS_ICON[role.status]}</b>{statusText(role.status,lang)}</span>
    {!creating&&<div className="km-cy-links">{!role.custom&&<><h3>{tr("how_work_moves")}</h3><div className="km-flowmap"><PeopleLine names={role.takesFrom} team={team}/><span className="km-arrow" aria-hidden="true">▼</span><span className="km-self"><Sprite id={role.id} size={26} head/>{role.name}</span><span className="km-arrow" aria-hidden="true">▼</span><PeopleLine names={role.givesTo} team={team}/></div></>}{role.callsUser&&<><h3>{tr("when_you_re_needed")}</h3><p>{role.callsUser}</p></>}</div>}
   </div>
   <div className="km-cy-right">
    <div className="km-cy-bar"><p>{role.intern?tr("intern_assigned_automatically_because_the_thread"):tr("cyborg_settings")}</p>{role.intern?null:!edit?<button className="km-btn-primary" onClick={()=>{restore();setEdit(true);}} disabled={!onSaveRole}>{tr("customize")}</button>:<div className="km-cy-actions"><button className="km-btn-primary" onClick={()=>void save()} disabled={busy}>{busy?tr("saving"):tr("save")}</button><button className="km-btn-ghost" disabled={busy} onClick={()=>{if(creating)onClose();else{setEdit(false);setErr(null);}}}>{tr("cancel")}</button>
     {role.custom&&!creating&&onDeleteRole&&<button className="km-btn-ghost km-delete-agent" onClick={()=>void change(onDeleteRole,onClose)} disabled={busy}>{tr('agent_delete')}</button>}
     {!role.custom&&role.customized&&<button className="km-btn-ghost" onClick={()=>void change(onResetRole,()=>setEdit(false))} disabled={busy}>{tr("reset_to_defaults")}</button>}</div>}</div>
    {err&&<p className="km-error" role="alert">{err}</p>}
    {edit&&<Module title={tr("cyborg")} icon="✦"><label className="km-field">{tr("name")}<input value={name} required onChange={e=>setName(e.target.value)}/></label>
     {role.custom&&<>
      <label className="km-field">{tr('agent_position')}<input value={position} onChange={e=>setPosition(e.target.value)}/></label>
      <label className="km-field">{tr('agent_stage')}<select value={stage} onChange={e=>setStage(e.target.value as StageId)}>{STAGES.map(s=><option key={s.id} value={s.id}>{tr(s.title)}</option>)}</select></label>
      <label className="km-field">{tr('agent_avatar')}<select value={avatar} onChange={e=>setAvatar(e.target.value)}>{builtinRoster.roles.map(r=><option key={r.id} value={r.id}>{dataText(lang,r.name)}</option>)}{[0,1,2,3].map(i=><option key={i} value={`intern${i}`}>{tr('intern_3',i+1)}</option>)}</select></label>
     </>}
     <label className="km-field">{tr("appearance")}<select value={look} onChange={e=>setLook(e.target.value as LookSet)}>{LOOK_SETS.map(l=><option key={l.id} value={l.id}>{tr(l.name)}</option>)}</select></label>
     <label className="km-field">{tr("glow")}<input type="color" value={glow} onChange={e=>setGlow(e.target.value)}/></label>
     {role.custom&&<label className="km-field">{tr('when_you_re_needed')}<input value={callsUser} onChange={e=>setCallsUser(e.target.value)}/></label>}
    </Module>}
    {role.providerAvailable===false&&<p className="km-small">{tr("provider")} {role.brains.provider} {tr("is_disconnected_the_project_s_default")}</p>}
    <Module title={tr("model_settings")} icon="◆" className="km-mod-brains">{!edit?<>
     <div className="km-brain"><span className={'km-prov km-prov-'+providerShort(role.brains).toLowerCase()}>{providerShort(role.brains)}</span><strong>{role.brains.model}</strong><EffortMeter effort={role.brains.effort}/></div>
     {e&&<p className="km-small">{tr("in_the_current_thread")} {e.model} · {e.reasoningLevel}</p>}</>:<>
     <label className="km-field">{tr("provider")}<select value={brains.providerId??''} onChange={ev=>{const p=MODEL_CATALOG.find(p=>p.providerId===ev.target.value);if(p)pickModel(p.providerId+'|'+p.models[0].id);}}>
      {!MODEL_CATALOG.some(p=>p.providerId===brains.providerId)&&<option value={brains.providerId??''}>{brains.provider}</option>}
      {MODEL_CATALOG.map(p=><option key={p.providerId} value={p.providerId}>{p.provider}</option>)}
     </select></label>
     <label className="km-field">{tr("model")}<select value={modelValue} onChange={ev=>pickModel(ev.target.value)}>{!MODEL_CATALOG.find(p=>p.providerId===brains.providerId)?.models.some(m=>m.id===brains.modelId)&&<option value={modelValue}>{brains.model}</option>}{MODEL_CATALOG.find(p=>p.providerId===brains.providerId)?.models.map(m=><option key={m.id} value={`${brains.providerId}|${m.id}`}>{m.name}</option>)}</select></label>
     <div className="km-field" role="group" aria-label={tr("effort_2")}>{tr("effort_2")}<div className="km-seg">{['',...EFFORTS].map(x=><button type="button" key={x} aria-pressed={brains.effort===x} onClick={()=>setBrains({...brains,effort:x})}>{x||tr("default")}</button>)}</div></div></>}
    </Module>
    <Module title={tr("tools")} icon="✋">
     <Chips items={(edit?hands:role.hands).map(value=>toolLabel(value,tr))} onRemove={edit?i=>setHands(items=>items.filter((_,index)=>index!==i)):undefined}/>
     {!role.intern&&onSaveRole&&<button ref={toolsButton} type="button" className="km-btn-ghost km-picker-add" aria-label={tr('picker_add_tools')} aria-haspopup="dialog" disabled={busy} onClick={()=>openPicker('tools')}>{tr('add_2')}</button>}
    </Module>
    <Module title={tr("skills")} icon="✦">
     <Chips items={edit?skills:role.skills} onRemove={edit?i=>setSkills(items=>items.filter((_,index)=>index!==i)):undefined}/>
     {!role.intern&&onSaveRole&&<button ref={skillsButton} type="button" className="km-btn-ghost km-picker-add" aria-label={tr('picker_add_skills')} aria-haspopup="dialog" disabled={busy} onClick={()=>openPicker('skills')}>{tr('add_2')}</button>}
    </Module>
    {!creating&&<><Module title={tr("chains", steps.length)} icon="⇢"><ol className="km-cy-steps">{steps.map(({path,step})=>{const go=stepLink(role,role.id,lang);const ask=askLink(role,role.id,lang);return <li key={step.id}>
     <ThreadLink className="km-cy-step" link={go} onThread={onThread} label={tr("step", step.title)}><span>{path.join(' › ')}</span><b>{step.title}</b></ThreadLink>
     {step.needsUser&&<ThreadLink className={'km-tag km-tag-user'+(ask.live?' is-live':'')} link={ask} onThread={onThread} label={tr("needs_your_answer")}>{ask.live?tr("open_question"):tr("needs_your_answer_2")}</ThreadLink>}
    </li>;})}</ol></Module>
    <Module title={tr("threads", role.threads.length)} icon="▤">{role.threads.length?<ul className="km-cy-threads">{role.threads.map(t=>{const s=threadStatus(t);return <li key={t.id}><button onClick={()=>onThread(t.id)}><span className={'km-dot km-dot-'+s} aria-hidden="true"/>{cleanTitle(t.title,lang)}<small>{statusText(s,lang)}</small></button></li>;})}</ul>:<p className="km-small">{tr("no_open_threads")}</p>}</Module></>}
   </div>
  </section>
  {picker&&<RolePicker kind={picker} role={{...role,role:position}} initialSkills={initialSkills} loadSkills={loadSkills}
   selected={picker==='skills'?skills:hands} setSelected={picker==='skills'?setSkills:setHands} onClose={closePicker}/>}
 </div>;
}

/* ---------- chains ---------- */
function kids(s:Step){return s.children||s.steps||[];}
function allRoles(s:Step):string[]{return [...(s.role?[s.role]:[]),...kids(s).flatMap(allRoles)];}
function anyUser(s:Step):boolean{return !!s.needsUser||kids(s).some(anyUser);}
function stepState(s:Step,team:RoleSummary[]):TeamStatus|null{
 const ids=new Set(allRoles(s));const st=team.filter(r=>ids.has(r.id)).map(r=>r.status);
 return st.includes('waiting')?'waiting':st.includes('working')?'working':st.includes('error')?'error':null;
}
function RoleFaces({ids,team,max=4}:{ids:string[];team:RoleSummary[];max?:number}){
 const uniq=[...new Set(ids)];const shown=uniq.slice(0,max);
 return <span className="km-faces">{shown.map(id=>{const r=team.find(x=>x.id===id);return r?<Sprite key={id} id={id} status={r.status} size={36} head/>:null;})}{uniq.length>max&&<b>+{uniq.length-max}</b>}</span>;
}
/** Тред звена: где висит вопрос, иначе ошибка, сданная работа, текущая задача роли. */
export function stepThread(r?:RoleSummary):{id:string;status:TeamStatus}|null{
 const l=stepLink(r,r?.id);return l.threadId?{id:l.threadId,status:l.status??'free'}:null;
}
export function Chains({blocks,team,initialPath=['production'],onThread}:{blocks:Step[];team:RoleSummary[];style?:string;initialPath?:string[];onThread?:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 const [path,setPath]=useState<string[]>(initialPath);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPath(p=>p.length>1?p.slice(0,-1):p);};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
 const levels:Step[]=[];let items:Step[]=blocks;
 for(const id of path){const s=items.find(x=>x.id===id);if(!s)break;levels.push(s);items=kids(s);}
 return <section className="km-chains" aria-label={tr("chains_2")}>
  <div className="km-legend" aria-hidden="true"><span className="km-lg-working">{tr("working_2")}</span><span className="km-lg-waiting">{tr("waiting_for_you_2")}</span><span className="km-lg-user">{tr("needs_your_answer_3")}</span></div>
  <ol className="km-cycle">{blocks.map((b,i)=>{const st=stepState(b,team);const open=path[0]===b.id;return <li key={b.id} className={'km-node'+(open?' is-open':'')+(st?' is-'+st:'')}>
   <button onClick={()=>setPath([b.id])} aria-expanded={open}>
    <span className="km-node-n">{String(i+1).padStart(2,'0')}</span>
    <span className="km-node-t">{b.title}</span>
    <RoleFaces ids={allRoles(b)} team={team} max={3}/>
    <span className="km-node-meta">{kids(b).length} {tr("steps")}{anyUser(b)&&<i className="km-user" title={tr("a_step_needs_your_answer")}>◆</i>}{st==='working'&&<i className="km-live">●</i>}{st==='waiting'&&<i className="km-wait">!</i>}</span>
   </button>
   {i<blocks.length-1&&<span className="km-pipe" aria-hidden="true"><i/><i/><i/></span>}
  </li>;})}</ol>
  <p className="km-loop" aria-hidden="true"><span>{tr("improvements_go_back_to_strategy_the")}</span></p>
  <div className="km-funnels">{levels.map((lvl,depth)=>{const list=kids(lvl);return <div key={lvl.id} className="km-funnel" style={{['--d' as string]:depth}}>
   <div className="km-mouth" aria-hidden="true"/>
   <header><nav className="km-crumb" aria-label={tr("workflow_level")}>{levels.slice(0,depth+1).map((s,k)=><button key={s.id} onClick={()=>setPath(path.slice(0,k+1))} aria-current={k===depth?'step':undefined}>{s.title}</button>)}</nav><span>{depth===0?tr("block_steps"):tr("nested_steps")} · {list.length}</span></header>
   <ol className="km-flow">{list.map((s,i)=>{const r=team.find(x=>x.id===s.role);const st=r?(r.status==='working'||r.status==='waiting'||r.status==='error'?r.status:null):null;const nested=kids(s).length>0;const open=path[depth+1]===s.id;return <li key={s.id} className={'km-stp'+(st?' is-'+st:'')+(open?' is-open':'')}>
    {r&&<Sprite id={r.id} status={r.status} size={44}/>}
    <div className="km-stp-body"><span className="km-stp-n">{String(i+1).padStart(2,'0')}{r&&<> · {r.name}</>}</span><b>{s.title}</b>{s.output&&<p>{s.output}</p>}
     <StepTags step={s} role={r} st={st} onThread={onThread}/>
     {nested&&<button className="km-open" aria-expanded={open} onClick={()=>setPath(open?path.slice(0,depth+1):[...path.slice(0,depth+1),s.id])}>{open?tr("collapse_steps"):tr("expand_steps", kids(s).length)}</button>}
    </div></li>;})}</ol>
  </div>;})}</div>
 </section>;
}

function StepTags({step,role,st,onThread}:{step:Step;role?:RoleSummary;st:TeamStatus|null;onThread?:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 const go=stepLink(role,step.role,lang);const ask=askLink(role,step.role,lang);
 return <span className="km-stp-tags">
  {step.needsUser&&<ThreadLink className={'km-tag km-tag-user'+(ask.live?' is-live':'')} link={ask} onThread={onThread} label={tr("needs_your_answer")}>{ask.live?tr("open_question"):tr("needs_your_answer_2")}</ThreadLink>}
  {st==='working'&&<em className="km-tag-live">{tr("assignee_is_working")}</em>}
  {st==='waiting'&&<ThreadLink className="km-tag km-tag-wait" link={ask} onThread={onThread}>{tr("assignee_is_waiting_for_you")}</ThreadLink>}
  <ThreadLink className="km-tag km-tag-thread" link={go} onThread={onThread} label={tr("thread_for", step.title)}>{go.threadId?tr("thread"):tr("no_thread")}</ThreadLink>
 </span>;
}

/* ---------- schema: the whole hierarchy on one screen ---------- */
function liveOf(r?:RoleSummary):TeamStatus|null{return r&&r.status!=='free'?r.status:null;}
function StepTree({steps,team,onOpen,onThread}:{steps:Step[];team:RoleSummary[];onOpen:(id:string,el:HTMLElement)=>void;onThread:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 return <ul className="km-tree">{steps.map(s=>{const r=team.find(x=>x.id===s.role);const st=liveOf(r);const go=stepLink(r,s.role,lang);const ask=askLink(r,s.role,lang);return <li key={s.id} className={st?'is-'+st:''}>
  <div className="km-tree-row">
   {r?<button type="button" className="km-tree-face" onClick={e=>onOpen(r.id,e.currentTarget)} aria-label={tr("role_card_for_3", r.name, statusText(r.status,lang))} title={tr("role_card_for_4", r.name)}><Sprite id={r.id} status={r.status} size={26} head/></button>:<span className="km-rail-noface" aria-hidden="true">·</span>}
   <span className="km-tree-text">
    <ThreadLink className="km-tree-go" link={go} onThread={onThread} label={tr("step_2", s.title, r?', '+r.name:'')}><b>{s.title}</b><small>{r?r.name:''}{s.output?(r?' · ':'')+s.output:''}</small></ThreadLink>
    {(s.needsUser||st)&&<span className="km-stp-tags">{s.needsUser&&<ThreadLink className={'km-tag km-tag-user'+(ask.live?' is-live':'')} link={ask} onThread={onThread} label={tr("needs_your_answer")}>{ask.live?tr("open_question_2"):tr("your_answer")}</ThreadLink>}{st&&<em className={'km-tag-'+(st==='working'?'live':st==='waiting'?'wait':st)}>{STATUS_ICON[st]} {statusText(st,lang).toLowerCase()}</em>}</span>}
   </span>
  </div>
  {kids(s).length>0&&<StepTree steps={kids(s)} team={team} onOpen={onOpen} onThread={onThread}/>}
 </li>;})}</ul>;
}
function OrgPerson({r,people,onOpen,onThread}:{r:RoleSummary;people:Map<string,RoleSummary>;onOpen:(id:string,el:HTMLElement)=>void;onThread:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 const to=r.current?.handoffTo??(r.givesTo[0]===tr("you")?'user':[...people.values()].find(p=>p.name===r.givesTo[0])?.id);
 const link:LinkTarget=r.current?{threadId:r.current.id,status:r.status,why:tr("open_task_thread")}:{threadId:null,status:null,why:tr("has_no_open_thread", r.name)};
 return <li className={'km-org-p is-'+r.status}><div className="km-org-card">
  <button type="button" className="km-org-open" onClick={e=>onOpen(r.id,e.currentTarget)} aria-label={tr("role_card_for", r.name, r.role, statusText(r.status,lang))} title={tr("role_card_for_4", r.name)}><Sprite id={r.id} status={r.status} size={34} head/></button>
  <span className="km-org-text"><button type="button" className="km-org-name" onClick={e=>onOpen(r.id,e.currentTarget)} tabIndex={-1} aria-hidden="true"><b>{r.name}<small>{r.role}</small></b></button>
   <ThreadLink className={'km-pill km-pill-'+r.status} link={link} onThread={onThread} label={`${r.name}: ${r.current?cleanTitle(r.current.title,lang):statusText(r.status,lang)}`}><b>{STATUS_ICON[r.status]}</b>{r.current?cleanTitle(r.current.title,lang):statusText(r.status,lang)}</ThreadLink>
   {to&&<span className="km-org-to">{tr("hands_off_to_2")} <Who id={to} people={people} size={16}/></span>}
  </span>
 </div></li>;
}
export function Schema({data,blocks,onOpen,onThread}:{data:TeamViewData;blocks:Step[];onOpen:(id:string,el:HTMLElement)=>void;onThread:(id:string)=>void}){
 const tr=useText();const lang=useLanguage();
 const people=peopleOf(data);const by=(id:string)=>people.get(id);
 const stas=by('stas');
 const deps:{title:string;note:string;list:RoleSummary[]}[]=[
  {title:tr("planning"),note:tr("think_and_write"),list:THINK.map(by).filter(Boolean) as RoleSummary[]},
  {title:tr("production"),note:tr("make_and_review"),list:MAKE.map(by).filter(Boolean) as RoleSummary[]},
  ...(data.interns.length?[{title:tr("interns"),note:tr("threads_without_a_role"),list:data.interns}]:[]),
 ];
 return <section className="km-schema" aria-label={tr("roles_and_workflow")}>
  <div className="km-sch-head"><h2>{tr("the_team_at_a_glance")}</h2><p>{tr("see_who_hands_work_to_whom")}</p></div>
  <ol className="km-levels" aria-label={tr("levels")}>
   <li><span>1</span>{tr("office")}</li><li><span>2</span>{tr("groups")}</li><li><span>3</span>{tr("people_and_their_tasks")}</li><li><span>4</span>{tr("workflow")}</li><li><span>5</span>{tr("steps_and_nested_workflows")}</li>
  </ol>
  <div className="km-org">
   <div className="km-org-root">
    <span className="km-org-user"><span className="km-who-user" aria-hidden="true">{tr("y")}</span><b>{tr("you")}</b><small>{tr("assigns_tasks_and_makes_decisions")}</small></span>
    <span className="km-org-line" aria-hidden="true"/>
    {stas&&<ul className="km-org-stas"><OrgPerson r={stas} people={people} onOpen={onOpen} onThread={onThread}/></ul>}
    <span className="km-org-line" aria-hidden="true"/>
   </div>
   <div className="km-org-deps">{deps.map(d=><section key={d.title} className="km-org-dep"><h3>{d.title}<small>{d.note}</small></h3><ul>{d.list.map(r=><OrgPerson key={r.id} r={r} people={people} onOpen={onOpen} onThread={onThread}/>)}</ul></section>)}</div>
  </div>
  <h2 className="km-sch-cycle">{tr("workflow_2")} {blocks.length} {tr("blocks_all_steps_expanded")}</h2>
  <ol className="km-sch-blocks">{blocks.map((b,i)=>{const st=stepState(b,data.team);return <li key={b.id} className={'km-sch-block'+(st?' is-'+st:'')}>
   <header><span className="km-node-n">{String(i+1).padStart(2,'0')}</span><b>{b.title}</b>{anyUser(b)&&<i className="km-user" title={tr("a_step_needs_your_answer")}>◆</i>}</header>
   <StepTree steps={kids(b)} team={data.team} onOpen={onOpen} onThread={onThread}/>
  </li>;})}</ol>
  <p className="km-loop" aria-hidden="true"><span>{tr("improvements_go_back_to_strategy_the")}</span></p>
 </section>;
}

/* ---------- Stas board ---------- */
const BOARD_TEXT:Partial<Record<string,MessageKey>>={todo:"queued",working:"in_progress",waiting:"waiting_for_you_3",review:"in_review",done:"done",dropped:"dropped"};
const ACTIVE=['active','starting','pending'];
export function boardTone(r:BoardRowView):TeamStatus{
 if(r.invalidThread)return 'error';
 if(r.live?.pending||r.status==='waiting')return 'waiting';
 if(r.live?.status==='error')return 'error';
 if(r.status==='done'||r.status==='dropped')return 'free';
 if(r.live&&ACTIVE.includes(r.live.status))return 'working';
 if(r.status==='review')return 'delivered';
 return r.status==='working'?'working':'free';
}
const hhmm=(at?:number|null)=>at?new Date(at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
export function StasBoard({boards,data,people,onThread,onCard,onClose}:{boards:BoardView[];data:TeamViewData;people:Map<string,RoleSummary>;onThread:(id:string)=>void;onCard:()=>void;onClose:()=>void}){
 const tr=useText();const lang=useLanguage();
 const dlg=useRef<HTMLElement>(null);const [closed,setClosed]=useState(false);
 useEffect(()=>{dlg.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[onClose]);
 const coord=data.coordinatorThreadId??null;
 const all=[...data.team,...data.interns].flatMap(r=>r.threads);
 const delegated=coord?all.filter(t=>t.parentThreadId===coord):[];
 const go=(id:string|null)=>{if(id){onClose();onThread(id);}};
 return <div className="km-backdrop" onMouseDown={ev=>{if(ev.target===ev.currentTarget)onClose();}}>
  <section ref={dlg} tabIndex={-1} className="km-board" role="dialog" aria-modal="true" aria-label={tr("stas_s_tasks")}>
   <button className="km-close" onClick={onClose} aria-label={tr("close")}>×</button>
   <header className="km-board-head"><Sprite id="stas" size={56} head/><div><h2>{tr("stas_s_tasks")}</h2><p>{tr("the_board_tracks_the_coordinator_s")}</p></div>
    <div className="km-board-actions"><button className="km-btn-ghost" onClick={onCard}>{tr("stas_s_role_card")}</button>{coord&&<button className="km-btn-ghost" onClick={()=>go(coord)}>{tr("coordinator_thread")}</button>}</div></header>
   {!boards.some(b=>b.primary)&&<section className="km-board-sec"><h3>{tr("project_coordinator")}<small>{tr("showing_threads_the_coordinator_started_dispatch")}</small></h3>
    {delegated.length?<ul className="km-board-rows">{delegated.map(t=>{const s=threadStatus(t);return <li key={t.id}><button onClick={()=>go(t.id)}>
     <span className={'km-pill km-pill-'+s}><b>{STATUS_ICON[s]}</b>{statusText(s,lang)}</span><span className="km-board-task">{cleanTitle(t.title,lang)}</span>
     <span className="km-board-who">{t.roleId?<Who id={t.roleId} people={people} size={18}/>:null}</span><time>{hhmm(t.latestAttentionAt??t.createdAt)}</time></button></li>;})}</ul>:<p className="km-small">{tr("no_tasks_in_progress")}</p>}
   </section>}
   {boards.map(b=>{const rows=b.rows.filter(r=>closed||!(r.status==='done'||r.status==='dropped'));return <section key={b.id} className="km-board-sec">
    <h3>{b.primary?tr("project_coordinator"):b.title}<small>{tr("shift")} {b.shifts.length} · <button type="button" className="km-link" onClick={()=>go(b.currentThreadId)}>{tr("stas_s_thread")}</button>{b.config?tr("handoff_at_context", Math.round(b.config.handoffAt*100)):''}</small></h3>
    {b.shiftBlockedUntil!=null&&<p className="km-small" role="status">{tr('shift_limit',SHIFT_LIMIT)}</p>}
    {b.handoff&&<details className="km-board-handoff"><summary>{tr("shift_handoff")} {hhmm(b.handoff.at)}{b.handoff.usage!=null?tr("context_was", Math.round(b.handoff.usage*100)):''}</summary><p>{b.handoff.note}</p></details>}
    {rows.length?<ul className="km-board-rows">{rows.map(r=>{const s=boardTone(r);return <li key={r.id}><button onClick={()=>go(r.threadId)} disabled={!r.threadId} title={tr(r.invalidThread?'board_invalid_thread':r.threadId?'open_assignee_thread':'thread_hasn_t_started')}>
     <span className={'km-pill km-pill-'+s}><b>{STATUS_ICON[s]}</b>{r.invalidThread?tr('board_invalid_thread'):BOARD_TEXT[r.status]?tr(BOARD_TEXT[r.status]!):r.status}{r.live?.pending&&r.status!=='waiting'?tr("waiting_for_you_4"):''}</span>
     <span className="km-board-task">{r.task}{r.note&&<small>{r.note}</small>}</span>
     <span className="km-board-who"><Who id={r.roleId} people={people} size={18}/></span><time>{hhmm(r.updatedAt)}</time></button></li>;})}</ul>:<p className="km-small">{b.rows.length?tr("no_open_tasks"):tr("board_is_empty")}</p>}
   </section>;})}
   <label className="km-board-closed"><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/>{tr("show_closed_tasks")}</label>
  </section>
 </div>;
}

/* ---------- page ---------- */
function Decor(){
 return <div className="km-wall" aria-hidden="true">
  {[0,1,2].map(i=><svg key={i} className="km-window" viewBox="0 0 32 20" shapeRendering="crispEdges"><rect width="32" height="20" fill="var(--km-frame)"/><rect x="2" y="2" width="13" height="16" fill="var(--km-sky)"/><rect x="17" y="2" width="13" height="16" fill="var(--km-sky)"/><rect className="km-star" x={5+i*2} y="5" width="1" height="1" fill="var(--km-star)"/><rect className="km-star km-star-b" x="22" y={7+i} width="1" height="1" fill="var(--km-star)"/><rect x={20-i} y="4" width="4" height="3" fill="var(--km-moon)"/><rect x="2" y="15" width="28" height="3" fill="var(--km-city)"/><rect x={6+i} y="12" width="3" height="3" fill="var(--km-city)"/><rect x={24-i} y="11" width="3" height="4" fill="var(--km-city)"/></svg>)}
  <svg className="km-clock" viewBox="0 0 12 12" shapeRendering="crispEdges"><rect x="2" y="0" width="8" height="12" fill="#1d1b26"/><rect x="0" y="2" width="12" height="8" fill="#1d1b26"/><rect x="2" y="2" width="8" height="8" fill="#f4f1ea"/><rect x="5" y="3" width="1" height="3" fill="#1d1b26"/><rect x="6" y="5" width="2" height="1" fill="#d8363f"/></svg>
  {[0,1].map(i=><svg key={'p'+i} className={'km-plant km-plant-'+i} viewBox="0 0 12 16" shapeRendering="crispEdges"><rect x="5" y="0" width="2" height="4" fill="#3f9b62"/><rect x="2" y="2" width="3" height="3" fill="#2e7a4b"/><rect x="7" y="3" width="3" height="3" fill="#3f9b62"/><rect x="3" y="5" width="6" height="4" fill="#2e7a4b"/><rect x="2" y="9" width="8" height="7" fill="#1d1b26"/><rect x="3" y="9" width="6" height="6" fill="#c46a2c"/></svg>)}
 </div>;
}

/** Стрелка между узлами цепочки. Горячая: по ней сейчас едет задача. */
const OFFICE_DECOR=[
 ['plant','left'],['cooler','right'],['bookcase','left'],['board','left'],['sofa','right'],
] as const;

function FlowLink({hot,label,decoration}:{hot:boolean;label?:string;decoration?:readonly [OfficeProp,'left'|'right']}){
 const prop=decoration&&officePropRuns(decoration[0]);
 return <div className={'km-flow-link'+(hot?' is-hot':'')} aria-hidden="true"><span className="km-flow-line"/>{hot&&<span className="km-flow-packet"><Envelope/></span>}{label&&<small>{label}</small>}
  {prop&&decoration&&<svg className={`km-office-prop km-office-prop-${decoration[1]}`} data-prop={decoration[0]} viewBox={`0 0 ${prop.width} ${prop.height}`} width={prop.width*4} height={prop.height*4} shapeRendering="crispEdges" aria-hidden="true">
   {prop.pixels.map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}
  </svg>}
 </div>;
}
function DemoBar({step,loop,onLoop,onStop}:{step:number;loop:boolean;onLoop:(v:boolean)=>void;onStop:()=>void}){
 const tr=useText();const lang=useLanguage();
 const s=DEMO_STEPS[step];
 return <div className="km-demo-bar" role="status" aria-live="polite">
  <div className="km-demo-head"><b>{tr("test_run_2")}</b><span>«{tr(DEMO_TASK)}{tr("step_3")} {step+1} {tr("of")} {DEMO_STEPS.length} {tr("simulation_no_agents_running")}</span>
   <label className="km-demo-loop"><input type="checkbox" checked={loop} onChange={e=>onLoop(e.target.checked)}/>{tr("loop")}</label>
   <button type="button" className="km-btn-ghost" onClick={onStop}>{tr("stop_2")}</button></div>
  <ol className="km-demo-log">{DEMO_STEPS.slice(0,step+1).map((x,i)=><li key={i} className={i===step?'is-now':''}>{tr(x.log)}</li>).reverse()}</ol>
 </div>;
}
function useDemo(){
 const [step,setStep]=useState<number|null>(null);const [loop,setLoop]=useState(false);
 useEffect(()=>{
  if(step===null)return;
  const last=step>=DEMO_STEPS.length-1;
  const t=setTimeout(()=>setStep(last?(loop?0:null):step+1),last?DEMO_STEP_MS*2:DEMO_STEP_MS);
  return()=>clearTimeout(t);
 },[step,loop]);
 return {step,loop,setLoop,toggle:()=>setStep(s=>s===null?0:null),stop:()=>setStep(null)};
}

/* ---------- настоящий прогон ---------- */
export interface ShowControl {
 /** Прогон виден только на доске своего проекта «Демо»: в проекте клиента здесь null. */
 run:ShowRun|null;here:boolean;running?:boolean;demoProjectId?:string|null;demoProjectName?:string;
 ready:boolean;busy?:boolean;error?:string|null;onStart:()=>Promise<void>;onStop:()=>Promise<void>;onOpenProject?:()=>void;
}
const usd=(n:number)=>'$'+n.toFixed(2);
function ShowButton({show}:{show:ShowControl}){
 const tr=useText();const lang=useLanguage();
 const running=show.run?.state==='running';
 // В чужом проекте кнопки нет: только строка о том, что прогон идёт, и переход в проект показа.
 if(!show.ready)return <button type="button" className="km-demo-btn" onClick={()=>window.alert(tr("add_an_empty_folder_to_bb"))}>{tr("run_demo")}</button>;
 if(!show.here&&!show.running)return <button type="button" className="km-demo-btn" onClick={show.onOpenProject}>{tr("open_demo_project")}</button>;
 if(!show.here)return show.running?<button type="button" className="km-demo-btn km-demo-btn-ghost" onClick={()=>show.onOpenProject?.()}
  title={tr("a_demo_is_running_in_open", show.demoProjectName??tr("demo"))}>{tr("demo_running_in")}{show.demoProjectName??tr("demo")}»</button>:null;
 return <button type="button" className={'km-demo-btn'+(running?' is-on':'')} disabled={show.busy||(!running&&!show.ready)} onClick={()=>void(running?show.onStop():show.onStart())}
  title={running?tr("stop_agents"):show.ready?tr("bb_agents_run_a_sample_task"):tr("the_demo_breeze_coffee_project_is")}>{running?tr("stop"):tr("run_demo")}</button>;
}
function useClock(on:boolean){const [t,setT]=useState(Date.now());useEffect(()=>{if(!on)return;const i=setInterval(()=>setT(Date.now()),1000);return()=>clearInterval(i);},[on]);return t;}
const mmss=(ms:number)=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const SHOW_END:Record<ShowRun['state'],MessageKey>={running:"running",done:"done",stopped:"stopped",error:"error",budget:"budget_reached"};
/** Панель прогона: кто участвует, журнал передач, деньги и время, итог с постером. */
function ShowBar({run,show,people,onThread,onClose}:{run:ShowRun;show:ShowControl;people:Map<string,RoleSummary>;onThread:(id:string)=>void;onClose:()=>void}){
 const tr=useText();const lang=useLanguage();
 const running=run.state==='running';const now=useClock(running);
 const {done,total}=showProgress(run);const final=run.steps.final;
 const cast=[...new Set(SHOW_STEPS.map(s=>s.roleId))];
 const roleStatus=(id:string)=>{const st=SHOW_STEPS.filter(s=>s.roleId===id).map(s=>run.steps[s.id]?.status);return st.includes('working')?'working':st.includes('waiting')?'waiting':st.includes('error')?'error':st.every(x=>x==='done')?'delivered':id==='stas'&&running&&st[0]==='done'?'working':'free';};
 return <section className={'km-show km-show-'+run.state} role="status" aria-live="polite" aria-label={tr("live_demo")}>
  <div className="km-demo-head"><b>{tr("live_demo")}</b><span>«{tr(SHOW_TASK)}» · {done} {tr("of")} {total} {tr("steps_2")} {tr(SHOW_END[run.state])}{run.why&&run.state!=='done'?`: ${run.why}`:''}</span>
   <span className="km-show-meter" title={run.costKnown?tr("cost_reported_by_bb"):tr("bb_reported_costs_for_some_threads")}>{usd(run.costUsd)}{run.costKnown?'':'+'} {tr("of")} {usd(run.budgetUsd)} · {mmss((run.endedAt??now)-run.startedAt)}</span>
   {running?<button type="button" className="km-btn-ghost" onClick={()=>void show.onStop()} disabled={show.busy}>{tr("stop_2")}</button>:<button type="button" className="km-btn-ghost" onClick={onClose}>{tr("close")}</button>}</div>
  <ul className="km-show-cast" aria-label={tr("participants")}>{cast.map(id=>{const p=people.get(id);const s=SHOW_STEPS.filter(x=>x.roleId===id);const tid=s.map(x=>run.steps[x.id]?.threadId).filter(Boolean).at(-1);
   return <li key={id} className={'km-show-who is-'+roleStatus(id)}><button type="button" disabled={!tid} onClick={()=>tid&&onThread(tid)} title={tid?tr("open_thread"):tr("not_started")}><Sprite id={id} size={28} head/><span><b>{p?.name??nameOf(id,lang)}</b><small>{s.map(x=>tr(x.title)).join(', ')}</small></span></button></li>;})}</ul>
  <ol className="km-demo-log km-show-log">{run.log.map((x,i)=><li key={i} className={i===run.log.length-1&&running?'is-now':''}>{x.text}</li>).reverse()}</ol>
  {show.error&&<p className="km-error" role="alert">{show.error}</p>}
  {(final?.status==='done'||run.poster)&&<div className="km-show-result">
   {run.poster&&<figure><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(run.poster)} alt={tr("promotion_poster_by_pixel")}/><figcaption>{tr("pixel_s_poster")}</figcaption></figure>}
   {final?.status==='done'&&<div className="km-show-itog"><h3>{tr("stas_s_result_for_you")}</h3><p>{final.text}</p>
    {final.threadId&&<button type="button" className="km-btn-ghost" onClick={()=>onThread(final.threadId!)}>{tr("open_result_thread")}</button>}
    <small>{tr("demo_files_in")} {run.dir} {tr("in_the_demo_breeze_coffee_project")}</small></div>}
  </div>}
 </section>;
}

export function TeamView({data:liveData,blocks,projects,projectId,onProject,onThread:onThreadLive,onSendTask,TaskField,PassesPanel,onSaveRole,onResetRole,onDeleteRole,loadSkills,initialSkills,initialPicker,show,theme='dark',error,loading,initialTab='team',initialRole=null,initialRoleEdit=false,initialAdd=false,initialChainPath,onLanguage,boards=[],initialBoard=false,initialFilter=null,roster=[],experiments=false,onExperiments,experimentControls}:{roster?:Role[];onLanguage?:(lang:Language)=>Promise<void>;experiments?:boolean;onExperiments?:(value:boolean)=>Promise<void>;experimentControls?:ReactNode;boards?:BoardView[];initialBoard?:boolean;initialFilter?:TeamStatus|null;data:TeamViewData|null;blocks:Step[];projects:{id:string;name:string}[];projectId:string;onProject:(id:string)=>void;theme?:Theme;error?:string|null;loading?:boolean;initialTab?:Tab;initialRole?:string|null;initialRoleEdit?:boolean;initialPicker?:PickerKind|null;initialSkills?:CatalogSkill[];initialAdd?:boolean;initialChainPath?:string[];style?:string}&TeamActions){
 const tr=useText();const lang=useLanguage();
 const demo=useDemo();
 const run=show?.run??null;
 const [showOpen,setShowOpen]=useState(()=>!!run&&(run.state==='running'||Date.now()-(run.endedAt??0)<30*60_000));
 useEffect(()=>{if(run&&(run.state==='running'||Date.now()-(run.endedAt??0)<30*60_000))setShowOpen(true);},[run?.id,run?.state]);
 // Настоящий прогон рисует офис по своим шагам; анимация главнее, пока её крутят.
 const showing=demo.step===null&&showOpen&&!!run;
 // В тест-прогоне офис рисует выдуманные статусы, клики по тредам никуда не ведут.
 const data=useMemo(()=>{
  if(liveData&&showing&&run){const team=showTeam(liveData.team,run,lang);return {...liveData,team,interns:[],waiting:team.filter(r=>r.status==='waiting').length,waitingSummary:null};}
  if(!liveData||demo.step===null)return liveData;
  const team=demoTeam(liveData.team,demo.step,lang);
  return {...liveData,team,interns:[],waiting:team.filter(r=>r.status==='waiting').length,waitingSummary:null};
 },[liveData,demo.step,showing,run,lang]);
 const onThread=demo.step!==null?()=>{}:onThreadLive;
 const queue=useMemo<QueueRow[]>(()=>demo.step!==null||showing?[]:boards.flatMap(b=>b.rows),[boards,demo.step,showing]);
 const showHot=showing&&run?showFlow(run):null;
 const [tab,setTab]=useState<Tab>(initialTab);const [selected,setSelected]=useState<string|null>(initialRole);const opener=useRef<HTMLElement|null>(null);
 const [addStage,setAddStage]=useState<StageId|null>(initialAdd?DEFAULT_STAGE:null);
 const draft=useMemo<RoleSummary|null>(()=>addStage?{...customRole('new-agent',addStage),status:'free',threads:[],current:null}:null,[addStage]);
 const [boardOpen,setBoardOpen]=useState(initialBoard);const [filter,setFilter]=useState<TeamStatus|null>(initialFilter);
 const close=useCallback(()=>{setSelected(null);setAddStage(null);opener.current?.focus();},[]);
 const closeBoard=()=>{setBoardOpen(false);opener.current?.focus();};
 const openBoard=(el:HTMLElement)=>{opener.current=el;setBoardOpen(true);};
 const open=(id:string,el:HTMLElement)=>{opener.current=el;setSelected(id);};
 const openAdd=(stage:StageId,el:HTMLElement)=>{opener.current=el;setSelected(null);setAddStage(stage);};
 const people=useMemo(()=>data?peopleOf(data):new Map<string,RoleSummary>(),[data]);
 const settingsRole=roster.find(r=>r.id===selected);
 const current=useMemo(()=>draft??(selected?(settingsRole?{status:'free' as const,threads:[],current:null,...people.get(selected),...settingsRole}:people.get(selected)):undefined),[draft,selected,settingsRole,people]);
 const styles=useMemo(()=>new Map([...roster.map(r=>[r.id,r] as const),...people]),[people,roster]);
 const [settingsError,setSettingsError]=useState('');
 const [changingLanguage,setChangingLanguage]=useState(false);
 const changeLanguage=async(value:Language)=>{setChangingLanguage(true);setSettingsError('');try{await onLanguage?.(value);}catch(e){setSettingsError(String(e));}finally{setChangingLanguage(false);}};
 const counts=useMemo(()=>{const c:Record<TeamStatus,number>={waiting:0,error:0,working:0,delivered:0,free:0};if(data)for(const i of railItems(data))c[i.status]++;c.waiting=data?.waiting??0;return c;},[data]);
 const byId=(id:string)=>data?.team.find(r=>r.id===id);
 const flows=useMemo(()=>data?liveFlows(data.team):new Set<string>(),[data]);
 const firstWaiting=data?railItems(data).find(i=>i.status==='waiting'):undefined;
 const projectName=projects.find(p=>p.id===projectId)?.name;
 return <SpriteStyles.Provider value={styles}><main className="km" data-theme={theme}>
  <header className="km-top">
   <div className="km-brand"><Sprite id="stas" size={44} head/><div><h1>Cyber Office</h1><p>{projectName?`${projectName} · `:''}{data?.team.length??0} {tr("agents")}{data?.interns.length?tr(data.interns.length===1?"and_one_intern":"and_interns", data.interns.length):''}{tr("one_desk")}</p></div></div>
   <nav className="km-tabs" aria-label={tr("view_2")}><button aria-current={tab==='team'?'page':undefined} onClick={()=>setTab('team')}>{tr("office")}</button><button aria-current={tab==='schema'?'page':undefined} onClick={()=>setTab('schema')}>{tr("scheme")}</button><button aria-current={tab==='chains'?'page':undefined} onClick={()=>setTab('chains')}>{tr("chains_2")}</button>{onSaveRole&&<button aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}>{tr("settings")}</button>}<button aria-current={tab==='passes'?'page':undefined} onClick={()=>setTab('passes')}>{tr("handoffs")}</button></nav>
   <label className="km-project"><span>{tr("project")}</span><select value={projectId} onChange={e=>{close();onProject(e.target.value);}}><option value="" disabled>{tr("choose_a_project")}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <button className={'km-waitpill'+((data?.waiting??0)>0?' is-on':'')} onClick={()=>firstWaiting&&onThread(firstWaiting.t.id)} disabled={!firstWaiting} aria-label={tr("waiting_for_you_open_first_thread", data?.waiting??0)}><b>!</b>{tr("waiting_for_you")} <strong>{data?.waiting??'…'}</strong></button>
  </header>
  {error&&<p className="km-error" role="alert">{tr("could_not_refresh")} {error}</p>}
  {loading&&!data&&<p className="km-small" role="status">{tr("loading_team")}</p>}
  {tab==='settings'?<section className="km-set"><div className="km-set-top"><h2>{tr("roles")}</h2>{onSaveRole&&<button type="button" className="km-btn-primary" onClick={e=>openAdd(DEFAULT_STAGE,e.currentTarget)}>{tr("add_agent")}</button>}{onLanguage&&<label className="km-project"><span>{tr("language")}</span><select value={lang} disabled={changingLanguage} onChange={e=>void changeLanguage(languageOf(e.target.value))}><option value="en">{tr("english")}</option><option value="ru">{tr("russian")}</option></select></label>}</div>{settingsError&&<p role="alert">{settingsError}</p>}<ul className="km-set-roles">{roster.map(r=><li key={r.id} className={r.enabled!==false?'on':'off'}><button type="button" className="km-set-who" onClick={e=>open(r.id,e.currentTarget)}><Sprite id={r.id} size={36} head/><span><b>{r.name}</b><small>{r.role}</small></span></button><label className="km-set-check"><input type="checkbox" checked={r.enabled!==false} disabled={r.id==='rams'} onChange={e=>void onSaveRole?.(r.id,{enabled:e.target.checked}).catch(x=>setSettingsError(String(x)))}/><span>{r.id==='rams'?tr("always_on"):tr("enabled")}</span></label></li>)}</ul>{onExperiments&&<label className="km-set-check km-set-exp"><input type="checkbox" checked={experiments} onChange={e=>void onExperiments(e.target.checked).catch(x=>setSettingsError(String(x)))}/><span>{tr("experimental_features")}</span></label>}{experiments&&experimentControls}</section>:!projectId?<p className="km-empty">{tr("choose_a_bb_project")}</p>:tab==='passes'?(PassesPanel?<PassesPanel key={projectId} projectId={projectId} names={new Map(roster.map(r=>[r.id,r.name]))}/>:<p className="km-empty">{tr("handoffs_unavailable_in_preview")}</p>):!data?null:tab==='team'?
   <div className="km-office">
    <Rail data={data} onThread={onThread} filter={filter}/>
    <section className={'km-room'+(filter?' is-filtered':'')} aria-label={tr("team_office")} data-filter={filter??undefined}>
     {filter&&<p className="km-filter-note" role="status">{tr("filter")} {statusText(filter,lang).toLowerCase()} <button type="button" className="km-btn-ghost" onClick={()=>setFilter(null)}>{tr("clear")}</button></p>}
     <Decor/>
     {byId('stas')&&<StasConsole role={byId('stas')!} counts={counts} coordinatorThreadId={data.coordinatorThreadId??null} projectName={projectName} onSendTask={onSendTask} TaskField={TaskField} onThread={onThread} onBoard={experiments?openBoard:el=>open('stas',el)} filter={filter} onFilter={setFilter} demo={demo.step!==null} onDemo={()=>{if(demo.step===null)setShowOpen(false);demo.toggle();}} show={show?{...show,onOpenProject:()=>show.demoProjectId&&onProject(show.demoProjectId),onStart:async()=>{demo.stop();setShowOpen(true);await show.onStart();}}:undefined}/>}
     {demo.step!==null&&<DemoBar step={demo.step} loop={demo.loop} onLoop={demo.setLoop} onStop={demo.stop}/>}
     {showing&&run&&show&&<ShowBar run={run} show={show} people={people} onThread={onThreadLive} onClose={()=>setShowOpen(false)}/>}
     {STAGES.map((s,i)=>{
      const seats=stageTeam(s,data.team).map(r=><Station key={r.id} role={r} people={people} onOpen={open} onThread={onThread} filter={filter} queue={queue}/>);
      if(onSaveRole)seats.push(<div key="add" className="km-st km-st-add"><div className="km-st-scene">
       <button type="button" className="km-st-hit" aria-label={tr('add_agent_to_stage',tr(s.title))} onClick={e=>openAdd(s.id,e.currentTarget)}><Desk/></button>
      </div></div>);
      if(!seats.length&&!showing&&demo.step===null)return null;
      const from=FLOW_ORDER[i];const hot=demo.step!==null?(DEMO_STEPS[demo.step].flow?.join('>')===`${from}>${s.id}`):showing?showHot?.join('>')===`${from}>${s.id}`:flows.has(`${from}>${s.id}`);
      return <section key={s.id} className="km-stage" data-stage={s.id} aria-label={tr("stage", i+1, tr(s.title))}>
      <FlowLink hot={hot} decoration={OFFICE_DECOR[i]} label={i===0?tr("stas_assigns_the_work"):tr("passes_work_to_the_next_stage")}/>
      <h2 className="km-zone"><b className="km-zone-n">{i+1}</b><span>{tr(s.title)}</span><small>{tr(s.note)}</small></h2>
      <DeskRows>{seats}</DeskRows>
     </section>;})}
     <FlowLink hot={demo.step!==null?DEMO_STEPS[demo.step].flow?.[0]==='launch':showHot?.[0]==='launch'} decoration={['coffee','left']} label={tr("stas_collects_the_result_and_brings")}/>
     {data.interns.length>0&&<><h2 className="km-zone"><span>{tr("interns")}</span><small>{tr("unassigned_threads_get_an_automatic_name")}</small></h2>
     <DeskRows>{data.interns.map(r=><Station key={r.id} role={r} people={people} onOpen={open} onThread={onThread} filter={filter} queue={queue}/>)}</DeskRows></>}
    </section>
   </div>:tab==='schema'?<Schema data={data} blocks={blocks} onOpen={open} onThread={onThread}/>:<Chains blocks={blocks} team={data.team} initialPath={initialChainPath} onThread={onThread}/>}
  {experiments&&boardOpen&&data&&!current&&<StasBoard boards={boards} data={data} people={people} onThread={onThread} onCard={()=>{setBoardOpen(false);setSelected('stas');}} onClose={closeBoard}/>}
  {current&&<CyborgCard key={current.id} creating={!!draft} initialEdit={!!draft||(initialRoleEdit&&current.id===initialRole)}
   initialPicker={current.id===initialRole?initialPicker:null} initialSkills={initialSkills} loadSkills={loadSkills}
   role={current} team={data?.team??[]} blocks={blocks} onClose={close} onThread={onThread} onSaveRole={onSaveRole} onResetRole={onResetRole} onDeleteRole={onDeleteRole}/>}
  <footer className="km-footer">{data?tr("updated", new Date(data.fetchedAt).toLocaleTimeString(lang,{hour:'2-digit',minute:'2-digit'})):tr("waiting_for_data")} {tr("select_a_person_for_their_role")}</footer>
 </main></SpriteStyles.Provider>;
}
export type {Role};
