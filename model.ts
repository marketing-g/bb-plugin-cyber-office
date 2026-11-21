import {dataText, DEFAULT_LANGUAGE, translator, type Language, type MessageKey} from './i18n.ts';
import type {LookSet} from './kiborgi.ts';
import {DEFAULT_STAGE,type StageId} from './flow.ts';
import roster from './team.json' with {type:'json'};
export type TeamStatus = 'waiting' | 'error' | 'working' | 'delivered' | 'free';
const STATUS_KEYS: Record<TeamStatus,MessageKey> = {waiting:"waiting_for_you_6",error:"error_2",working:"working_5",delivered:"delivered_check_it_2",free:"available"};
export function statusText(status:TeamStatus,lang=DEFAULT_LANGUAGE){return translator(lang)(STATUS_KEYS[status]);}
export interface Brains {provider:string;providerId?:string;model:string;modelId?:string;effort:string}
export interface Role {id:string;name:string;role:string;brains:Brains;hands:string[];skills:string[];takesFrom:string[];givesTo:string[];callsUser:string;customized?:boolean;enabled?:boolean;look?:LookSet;glow?:string;providerAvailable?:boolean;custom?:boolean;stage?:StageId;avatar?:string}
export interface RolePatch {name?:string;enabled?:boolean;look?:LookSet;glow?:string;brains?:Brains;hands?:string[];skills?:string[];role?:string;stage?:StageId;avatar?:string;callsUser?:string}
export interface Thread {
 id:string;projectId:string;title:string|null;status:string;hasPendingInteraction?:boolean;parentThreadId?:string|null;pinnedAt?:number|null;provider:string;hidden?:boolean;
 lastReadAt?:number|null;latestAttentionAt?:number|null;createdAt?:number|null;titleFallback?:string|null;
 execution?:{model:string;reasoningLevel:string}|null;executionError?:string;
 /** Who works on it: a role id or an intern id. Filled by summarize. */
 roleId?:string;
 /** Who receives the result: a role id, an intern id or 'user'. Filled by summarize. */
 handoffTo?:string;
}
export interface RoleSummary extends Role {status:TeamStatus;threads:Thread[];current:Thread|null;intern?:boolean}

/** Model catalog as BB lists it (`bb provider models`). Free text stays allowed. */
export const MODEL_CATALOG:{providerId:string;provider:string;models:{id:string;name:string}[]}[]=[
 {providerId:'claude-code',provider:'Anthropic',models:[{id:'claude-opus-5-5',name:'Opus 5.5'},{id:'claude-fable-5-2',name:'Fable 5.2'},{id:'claude-sonnet-5-5',name:'Sonnet 5.5'},{id:'claude-haiku-5-5',name:'Haiku 5.5'}]},
 {providerId:'codex',provider:'OpenAI / Codex',models:[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol'},{id:'gpt-6.1-terra',name:'GPT-6.1 Terra'},{id:'gpt-6-astra',name:'GPT-6 Astra'},{id:'gpt-6-luna',name:'GPT-6 Luna'}]},
];
export const EFFORTS=['low','medium','high','xhigh','max'] as const;

export function customRole(id:string,stage=DEFAULT_STAGE):Role {
 const p=MODEL_CATALOG[0],m=p.models[0];
 return {id,custom:true,name:'',role:'',stage,avatar:'intern0',look:'base',enabled:true,
  brains:{provider:p.provider,providerId:p.providerId,model:m.name,modelId:m.id,effort:''},
  hands:[],skills:[],takesFrom:[],givesTo:[],callsUser:''};
}

const normalizedName=(name:string)=>name.trim().normalize('NFC').toLowerCase();
export function roleInputError(role:Role,others:readonly Role[]):MessageKey|null {
 const name=normalizedName(role.name);
 if(!name)return 'agent_name_required';
 if([...role.name.trim()].length>40)return 'agent_name_too_long';
 if([...role.role.trim()].length>60)return 'agent_position_too_long';
 if(others.some(other=>other.id!==role.id&&other.enabled!==false&&normalizedName(other.name)===name))
  return 'agent_name_in_use';
 return null;
}

export function threadStatus(t:Thread):TeamStatus {
 if(t.hasPendingInteraction)return 'waiting';
 if(t.status==='error')return 'error';
 if(['active','starting','pending'].includes(t.status))return 'working';
 // Finished turn the user has not opened yet: BB marks it unread.
 if(t.latestAttentionAt!=null&&(t.lastReadAt==null||t.lastReadAt<t.latestAttentionAt))return 'delivered';
 return 'free';
}
const order:TeamStatus[]=['waiting','error','working','delivered','free'];
export function statusRank(s:TeamStatus){return order.indexOf(s);}

/**
 * Words that point a thread to a role when the title has no `[Имя]` prefix.
 * The earliest match in the title wins; on a tie the longer word wins, so
 * «визуальная приёмка» goes to the critic, not to the designer.
 */
export const ROLE_KEYWORDS:Record<string,string[]>={
 stas:['координ','распредел','coordinat','assign task'],
 ada:['аналит','замер','метрик','экспорт','ga4','gtm','данны','цифр','отчёт по','analytics','metrics','measurement','sales data','export'],
 sherlock:['ресёрч','ресерч','исследов','референс','конкурент','разведк','факт','research','reference','competitor'],
 mark:['стратег','позиционир','оффер','бюджет','цена','цены','ценообраз','прайс','strategy','positioning','offer','pricing','budget'],
 radar:['затык','узкое место','проба','разведчик','scout','bottleneck','experiment'],
 nora:['текст','копирайт','пост','письм','сценари','заголов','copy','headline','caption','newsletter'],
 sema:['seo','сео','индексац','sitemap','search console','поисков','indexing','search ranking'],
 pixel:['дизайн','креатив','эскиз','постер','баннер','визуал','макет','обложк','design','creative','poster','sketch','banner','mockup'],
 rams:['визуальная приёмка','приёмк','критик','ревью','review','контроль качеств','quality check','visual review','critic'],
 kadr:['видео','ролик','монтаж','озвуч','голос','reels','video','voiceover','audio editing'],
 bolt:['сайт','код','сборк','деплой','вёрстк','верстк','баг','тест сайта','site','build','deploy','code','bug fix','redirect'],
 tara:['реклам','кампани','таргет','трафик','ads','paid traffic','campaign','targeting'],
};
export function guessRole(text:string|null|undefined):string|null{
 const s=(text||'').toLocaleLowerCase('ru');if(!s)return null;
 let best:{id:string;at:number;len:number}|null=null;
 for(const [id,words] of Object.entries(ROLE_KEYWORDS))for(const w of words){
  const at=s.indexOf(w);if(at<0)continue;
  if(!best||at<best.at||(at===best.at&&w.length>best.len))best={id,at,len:w.length};
 }
 return best?.id??null;
}

/** Match saved custom names and both sets of built-in aliases. */
const roleAliases = new Map(roster.roles.map(({id,name,role})=>[id,[name,role,dataText('en',name),dataText('en',role)]]));

export function roleForKey<T extends Pick<Role,'id'|'name'|'role'>>(roles:readonly T[],key:string):T|undefined{
 const normalized=normalizedName(key);
 const matches=(value:string)=>normalizedName(value)===normalized;
 return roles.find(r=>matches(r.id))??roles.find(r=>matches(r.name))??roles.find(r=>
  matches(r.role)||roleAliases.get(r.id)?.some(matches));
}

export function localizeRole(base:Role,lang:Language,patch?:RolePatch|null,displayName?:(name:string)=>string):Role {
 if(base.custom)return applyPatch(base,patch);
 const tr=translator(lang);
 const name=(n:string)=>n==='вы'?tr('you'):displayName?.(n)??dataText(lang,n);
 return applyPatch({...base,name:dataText(lang,base.name),role:dataText(lang,base.role),
  hands:base.hands.map(h=>dataText(lang,h)),callsUser:dataText(lang,base.callsUser),
  takesFrom:base.takesFrom.map(name),givesTo:base.givesTo.map(name)},patch);
}

export function bindRole(t:Thread,roles:Role[],bindings:Record<string,string>,coordinators:Record<string,string>={}):string|null {
 const explicit=bindings[t.id];
 if(explicit && roles.some(r=>r.id===explicit))return explicit;
 const low=(x:string)=>x.toLocaleLowerCase('ru');
 const title=low((t.title||'').trim());
 const normalizedTitle=title.normalize('NFC');
 const named=title.startsWith('[')?roles.filter(r=>r.enabled!==false&&normalizedTitle.startsWith(`[${normalizedName(r.name)}]`))
  .sort((a,b)=>b.name.length-a.name.length)[0]:undefined;
 if(named)return named.id;
 const bracket=title.match(/^\[([^\]]+)\]/)?.[1];
 if(bracket){const named=roleForKey(roles,bracket);if(named)return named.id;}
 // «Пиксель: макет», «Ада: замер»: the role name as the first word.
 const first=title.split(/[\s:·,.]+/)[0];
 const byName=first?roleForKey(roles,first):undefined;
 if(byName)return byName.id;
 if(coordinators[t.projectId]===t.id || Object.values(coordinators).includes(t.id) || (!coordinators[t.projectId] && !t.parentThreadId && t.pinnedAt!=null))return 'stas';
 // The brief of an untitled thread starts with «Ты Сёма (SEO)…».
 const brief=low((t.titleFallback||'').trim());
 const introduction=brief.replace(/^reply in the user's language\s*/,'');
 const you=introduction.match(/^(?:ты|you are)\s+([^,(.:\n]+?)(?=\s*[(,:.]|$)/)?.[1];
 const firstName=/^(?:ты|you are)\s+([^\s,(.:]+)/.exec(introduction)?.[1];
 const introduced=(you&&roleForKey(roles,you))||(firstName&&roleForKey(roles,firstName));
 if(introduced)return introduced.id;
 const guess=guessRole(title)??guessRole(brief);
 return guess&&roles.some(r=>r.id===guess)?guess:null;
}

/** Names for interns: threads no role claims. Stable per thread id. */
const internNames=(lang:Language)=>Array.from({length:12},(_,i)=>translator(lang)("intern_3",i+1));
function hash(s:string){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))>>>0;return h;}
const PROVIDER_NAME:Record<string,string>={'claude-code':'Anthropic',codex:'OpenAI / Codex'};

export function applyPatch(role:Role,patch?:RolePatch|null):Role{
 if(!patch)return role;
 return {...role,...patch,enabled:role.id==='rams'||(patch.enabled??role.enabled??true),brains:patch.brains?{...role.brains,...patch.brains}:role.brains,hands:patch.hands??role.hands,skills:patch.skills??role.skills,customized:true};
}

/**
 * The team of one project. A project's threads count, and so do their
 * descendants in other projects: the Демо-проект coordinator starts the SEO
 * audit in the site checkout, and that thread still belongs to the team.
 */
export function summarize(roles:Role[],threads:Thread[],projectId:string,bindings:Record<string,string>={},coordinators:Record<string,string>={},lang=DEFAULT_LANGUAGE) {
 const tr=translator(lang);
 const byId=new Map(threads.map(t=>[t.id,t]));
 const home=(t:Thread)=>{const seen=new Set<string>();let x:Thread|undefined=t;while(x&&!seen.has(x.id)){if(x.projectId===projectId)return true;seen.add(x.id);x=x.parentThreadId?byId.get(x.parentThreadId):undefined;}return false;};
 const scoped=threads.filter(t=>!t.hidden&&home(t)).map(t=>({...t}));
 const scopedIds=new Set(scoped.map(t=>t.id));
 const roleOf=new Map<string,string>();
 for(const t of scoped){const r=bindRole(t,roles,bindings,coordinators);if(r)roleOf.set(t.id,r);}
 // Interns: one per thread nobody claims, named the same way every time.
 const names=internNames(lang);
 const used=new Set<string>();const interns:RoleSummary[]=[];
 const loose=scoped.filter(t=>!roleOf.has(t.id)).sort((a,b)=>(a.createdAt??0)-(b.createdAt??0)||a.id.localeCompare(b.id));
 for(const t of loose){
  let k=hash(t.id)%names.length;for(let i=0;i<names.length&&used.has(names[k]);i++)k=(k+1)%names.length;
  const name=used.has(names[k])?tr("intern_3", interns.length+1):names[k];used.add(name);
  const id='intern-'+t.id;roleOf.set(t.id,id);
  interns.push({id,name,role:tr("intern_2"),brains:{provider:PROVIDER_NAME[t.provider]??t.provider,providerId:t.provider,model:tr("thread_default"),effort:''},hands:[],skills:[],takesFrom:[],givesTo:[],callsUser:tr("needs_access_a_decision_or_a"),intern:true,status:'free',threads:[],current:null});
 }
 const nameOf=(id:string)=>id==='user'?tr("you"):roles.find(r=>r.id===id)?.name??interns.find(r=>r.id===id)?.name??id;
 const roleByName=(n:string)=>/^(you|вы)$/i.test(n)?'user':roleForKey(roles,n)?.id;
 for(const t of scoped){
  const own=roleOf.get(t.id)!;t.roleId=own;
  const parent=t.parentThreadId?roleOf.get(t.parentThreadId)??(byId.has(t.parentThreadId)?undefined:'stas'):undefined;
  if(parent&&parent!==own)t.handoffTo=parent;
  else if(own==='stas')t.handoffTo='user';
  else{const base=roles.find(r=>r.id===own);t.handoffTo=(base&&base.givesTo.map(roleByName).find(Boolean))||'stas';}
 }
 const fill=(r:Role|RoleSummary):RoleSummary=>{
  const own=scoped.filter(t=>t.roleId===r.id).sort((a,b)=>order.indexOf(threadStatus(a))-order.indexOf(threadStatus(b))||(b.latestAttentionAt??0)-(a.latestAttentionAt??0)||a.id.localeCompare(b.id));
  return {...r,status:own.length?threadStatus(own[0]):'free',threads:own,current:own[0]??null};
 };
 const team=roles.filter(r=>r.enabled!==false).map(fill);
 const crew=interns.map(i=>{const r=fill(i);const to=r.current?.handoffTo;const from=r.current?.parentThreadId?roleOf.get(r.current.parentThreadId):undefined;return {...r,givesTo:to?[nameOf(to)]:[],takesFrom:from?[nameOf(from)]:[tr("you")]};});
 const coordinatorThreadId=coordinators[projectId]&&scopedIds.has(coordinators[projectId])?coordinators[projectId]:(team.find(r=>r.id==='stas')?.threads.find(t=>!t.parentThreadId)?.id??null);
 return {team,interns:crew,waiting:[...team,...crew].flatMap(r=>r.threads).filter(t=>t.hasPendingInteraction).length,coordinatorThreadId};
}

/** Where a role appears in the chain map, with the path of block titles. */
export interface ChainStepLike {id:string;title:string;role?:string;output?:string;needsUser?:boolean;children?:ChainStepLike[];steps?:ChainStepLike[]}
export function roleSteps(blocks:ChainStepLike[],roleId:string){
 const out:{path:string[];step:ChainStepLike}[]=[];
 const walk=(items:ChainStepLike[],path:string[])=>{for(const s of items){if(s.role===roleId)out.push({path,step:s});const kids=s.children||s.steps;if(kids)walk(kids,[...path,s.title]);}};
 walk(blocks,[]);
 return out;
}

/** Куда ведёт звено или «нужен ваш ответ»: id треда или пусто, и подсказка, почему так. */
export interface LinkTarget {threadId:string|null;status:TeamStatus|null;why:string}
const LINK_ORDER:TeamStatus[]=['waiting','error','delivered','working'];
/** Тред звена: где висит вопрос, иначе ошибка, сданная работа, текущая задача роли. */
export function stepLink(role:RoleSummary|null|undefined,roleId?:string|null,lang=DEFAULT_LANGUAGE):LinkTarget{
 const tr=translator(lang);
 if(!roleId&&!role)return {threadId:null,status:null,why:tr("this_step_has_no_assigned_role")};
 if(!role)return {threadId:null,status:null,why:tr("the_assigned_role_is_unavailable")};
 for(const s of LINK_ORDER){const t=role.threads.find(x=>threadStatus(x)===s);if(t)return {threadId:t.id,status:s,why:tr("open_s_thread", role.name, statusText(s,lang).toLowerCase())};}
 if(role.current)return {threadId:role.current.id,status:threadStatus(role.current),why:tr("open_s_thread_2", role.name)};
 return {threadId:null,status:null,why:tr("has_no_open_thread_for_this", role.name)};
}
/** «Нужен ваш ответ»: тред, где висит вопрос; если вопроса нет, тред исполнителя. */
export function askLink(role:RoleSummary|null|undefined,roleId?:string|null,lang=DEFAULT_LANGUAGE):LinkTarget&{live:boolean}{
 const tr=translator(lang);
 const t=role?.threads.find(x=>x.hasPendingInteraction);
 if(role&&t)return {threadId:t.id,status:'waiting',why:tr("open_s_question_thread", role.name),live:true};
 const s=stepLink(role,roleId,lang);
 return {...s,live:false,why:s.threadId?tr("open_s_thread_there_s_no", role!.name):tr("no_question_pending", s.why)};
}
