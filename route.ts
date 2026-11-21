// Разнос ответа пользователя по агентам: чистая логика без SDK.
// Сервер (route-server.ts) строит план, форма (route-form.tsx) его показывает,
// отправка идёт только после кнопки пользователя.
import {DEFAULT_LANGUAGE,quoteLines,translator,type Language} from './i18n.ts';
import {guessRole,roleForKey,threadStatus,type RoleSummary,type TeamStatus} from './model';

export const NO_SEND:readonly string[]=[];
export const MAX_PIECES=12;
export const MAX_TEXT=4000;
export const LOG_LIMIT=20;
export const FORM_TIMEOUT_MS=30*60*1000;

/** Что агент передаёт в team_route. */
export interface RoutePiece {to:string;quote:string;note?:string}
/** Тред, куда можно отправить кусок. */
export interface RouteTarget {threadId:string;roleId:string;name:string;role:string;title:string;status:TeamStatus;intern:boolean}
export interface RouteRow {
 quote:string;note:string;
 /** Выбранный получатель; null, если треда нет или строка заблокирована. */
 threadId:string|null;
 /** Роль, которую агент назвал или угадали по тексту. */
 roleId:string|null;roleName:string|null;
 /** Живые треды этой роли, лучший первым. */
 candidates:RouteTarget[];
 /** Получателя угадали по словам: «проверьте». */
 guessed:boolean;
 /** Кусок есть в последних сообщениях пользователя дословно. */
 verbatim:boolean;
 /** Причина блокировки; строку нельзя отправить. */
 blocked:string|null;
}
export type RouteOrigin='tool'|'manual'|'forward';
export interface RoutePlan {
 id:string;sourceThreadId:string;sourceTitle:string;sourceName:string;projectId:string;origin:RouteOrigin;createdAt:number;
 rows:RouteRow[];
 /** Все треды команды, которые можно выбрать в форме. */
 recipients:RouteTarget[];
}
/** Что форма возвращает по кнопке «Отправить». */
export interface RouteSubmitRow {index:number;threadId:string|null;text:string;send:boolean}
export interface RouteSubmit {rows:RouteSubmitRow[]}
export type RouteDelivery='sent'|'queued'|'failed'|'skipped'|'blocked';
export interface RouteResultRow {index:number;threadId:string|null;name:string;title:string;text:string;delivery:RouteDelivery;error?:string}
export type RouteOutcome='sent'|'cancelled'|'interrupted'|'empty';
export interface RouteLogEntry {id:string;at:number;sourceThreadId:string;origin:RouteOrigin;outcome:RouteOutcome;reason?:string;rows:RouteResultRow[]}

const low=(s:string)=>s.toLocaleLowerCase('ru');
const cleanTitle=(t:string|null|undefined,lang:Language)=>(t||'').replace(/^\[[^\]]+\]\s*/,'').trim()||translator(lang)('untitled');

/** Почему в тред нельзя писать; null, если можно. */
export function blockReason(t:{id:string;title?:string|null;parentThreadId?:string|null;pinnedAt?:number|null},noSend:readonly string[]=NO_SEND,lang=DEFAULT_LANGUAGE):string|null{
 const tr=translator(lang);
 if(noSend.includes(t.id)||(!t.parentThreadId&&t.pinnedAt!=null))return tr('route_coordinator');
 const bare=(t.title??'').trim().replace(/^\[[^\]]+\]\s*/,'');
 if(/^(?:test|тест)\s*:/i.test(bare))return tr('route_test');
 if(/^(?:demo|показ)\s*:/i.test(bare))return tr('route_demo');
 return null;
}

/** Все треды команды как получатели. Заблокированные отдельно, источник исключён. */
export function targetsOf(people:RoleSummary[],sourceThreadId:string,noSend:readonly string[]=NO_SEND,lang=DEFAULT_LANGUAGE){
 const tr=translator(lang);
 const allowed:RouteTarget[]=[];const blocked:(RouteTarget&{reason:string})[]=[];
 for(const p of people)for(const t of p.threads){
  if(t.id===sourceThreadId)continue;
  const target:RouteTarget={threadId:t.id,roleId:p.id,name:p.name,role:p.role,title:cleanTitle(t.title??t.titleFallback,lang),status:threadStatus(t),intern:!!p.intern};
  const reason=p.id==='stas'&&!t.parentThreadId?tr('route_coordinator'):blockReason(t,noSend,lang);
  if(reason)blocked.push({...target,reason});else allowed.push(target);
 }
 return {allowed,blocked};
}
/** Роль по слову агента: id, имя или должность, без регистра. */
export function findRole(people:Pick<RoleSummary,'id'|'name'|'role'>[],to:string):string|null{
 const k=low(to.trim().replace(/^@/,''));if(!k)return null;
 return roleForKey(people,k)?.id??null;
}

/** Для сравнения: регистр, ё, кавычки, тире и пробелы не важны. */
export function normalize(s:string){
 return low(s).replace(/ё/g,'е').replace(/[«»„“”"']/g,'').replace(/[‐‑‒–—―]/g,'-').replace(/\s+/g,' ').replace(/^[\s\-•*\d.)]+/,'').replace(/[\s.,;:!?…]+$/,'').trim();
}
/** Кусок дословно есть в одном из сообщений пользователя. */
export function isVerbatim(quote:string,stasTexts:readonly string[]){
 const q=normalize(quote);if(!q)return false;
 return stasTexts.some(t=>normalize(t).includes(q));
}

export interface PlanInput {
 id:string;sourceThreadId:string;sourceTitle:string;sourceName:string;projectId:string;origin:RouteOrigin;createdAt:number;
 pieces:RoutePiece[];people:RoleSummary[];
 /** Последние сообщения пользователя в треде-источнике, для проверки дословности. */
 stasTexts:readonly string[];
 noSend?:readonly string[];
}
/** План разноса: по строке на кусок, получатель подобран, запреты отсечены. */
export function buildPlan(p:PlanInput,lang=DEFAULT_LANGUAGE):RoutePlan{
 const tr=translator(lang);
 const {allowed,blocked}=targetsOf(p.people,p.sourceThreadId,p.noSend,lang);
 const rows=p.pieces.slice(0,MAX_PIECES).map((piece):RouteRow=>{
  const quote=piece.quote.trim().slice(0,MAX_TEXT);const note=(piece.note??'').replace(/\s+/g,' ').trim().slice(0,200);
  // Forwarded agent text is not the user's speech: no verbatim check.
  const verbatim=p.origin==='forward'?true:isVerbatim(quote,p.stasTexts);
  const nameOf=(id:string|null)=>id?p.people.find(r=>r.id===id)?.name??null:null;
  const base={quote,note,verbatim};
  const to=piece.to.trim();
  // 1. Thread id.
  if(/^thr_/i.test(to)){
   if(to===p.sourceThreadId)return {...base,threadId:null,roleId:null,roleName:null,candidates:[],guessed:false,blocked:tr('route_source')};
   const hit=allowed.find(t=>t.threadId===to);
   if(hit)return {...base,threadId:hit.threadId,roleId:hit.roleId,roleName:hit.name,candidates:allowed.filter(t=>t.roleId===hit.roleId),guessed:false,blocked:null};
   const bad=blocked.find(t=>t.threadId===to);
   const reason=bad?bad.reason:(p.noSend??NO_SEND).includes(to)?tr('route_coordinator'):tr('route_foreign');
   return {...base,threadId:null,roleId:bad?.roleId??null,roleName:nameOf(bad?.roleId??null),candidates:[],guessed:false,blocked:reason};
  }
  // 2. Role. 3. «?» or an unknown word: guess by the text.
  let roleId=to==='?'?null:findRole(p.people,to);let guessed=false;
  if(!roleId){roleId=guessRole(quote);guessed=true;if(roleId&&!p.people.some(r=>r.id===roleId))roleId=null;}
  const candidates=roleId?allowed.filter(t=>t.roleId===roleId):[];
  return {...base,threadId:candidates[0]?.threadId??null,roleId,roleName:nameOf(roleId),candidates,guessed,blocked:null};
 });
 return {id:p.id,sourceThreadId:p.sourceThreadId,sourceTitle:p.sourceTitle,sourceName:p.sourceName,projectId:p.projectId,origin:p.origin,createdAt:p.createdAt,rows,recipients:allowed};
}

/**
 * Ручная кнопка на сообщении пользователя: абзацы и пункты списка становятся кусками.
 * Получателя угадываем по словам, вы проверяет в форме.
 */
export function splitMessage(text:string):string[]{
 const out:string[]=[];
 for(const para of text.replace(/\r\n?/g,'\n').split(/\n\s*\n/)){
  const lines=para.split('\n');
  const item=/^\s*(?:\d{1,2}[.)]|[-•*–])\s+/;
  if(lines.filter(l=>item.test(l)).length>=2){
   // A list: the lead line goes with nothing, each item is a piece; wrapped lines join their item.
   let cur:string|null=null;
   for(const l of lines){
    if(item.test(l)){if(cur)out.push(cur);cur=l.replace(item,'').trim();}
    else if(cur!==null)cur+=' '+l.trim();
    else if(l.trim())out.push(l.trim());
   }
   if(cur)out.push(cur);
  }else{const p=lines.map(l=>l.trim()).filter(Boolean).join(' ');if(p)out.push(p);}
 }
 return out.filter(Boolean).slice(0,MAX_PIECES);
}

/** Сколько строк уйдёт, если вы ничего не поменяет. */
export function sendableCount(plan:RoutePlan){return plan.rows.filter(r=>!r.blocked&&r.threadId).length;}

/** Значение формы по умолчанию: всё, что можно отправить, отмечено. */
export function defaultSubmit(plan:RoutePlan):RouteSubmit{
 return {rows:plan.rows.map((r,index)=>({index,threadId:r.threadId,text:r.quote,send:!r.blocked&&!!r.threadId}))};
}

/** Сообщение агенту-получателю. */
export function recipientMessage(o:{sourceTitle:string;sourceName:string;text:string;quote:string;note:string;verbatim:boolean;origin:RouteOrigin},lang=DEFAULT_LANGUAGE){
 const tr=translator(lang);
 const where=`“${o.sourceTitle}” (${o.sourceName})`.replace(/\s+/g,' ');
 const edited=o.text.trim()!==o.quote.trim();
 const head=tr(o.origin==='forward'?'route_user_forwarded':edited?'route_user_edited':o.verbatim?'route_user_quote':'route_agent_paraphrase',where);
 return [tr('reply_user_language'),head,quoteLines(o.text),o.note?tr('route_agent_context',o.note):'',tr(o.origin==='forward'?'route_forward_reply':'route_recipient_reply')].filter(Boolean).join('\n');
}

/**
 * Проверка ответа формы по плану из kv. Форма не источник правды: получатель
 * должен быть в списке плана, заблокированные строки не уходят никогда.
 */
export function resolveSubmit(plan:RoutePlan,value:unknown,noSend:readonly string[]=NO_SEND):{index:number;threadId:string|null;text:string;send:boolean;reason?:string}[]{
 const raw=(value&&typeof value==='object'&&Array.isArray((value as RouteSubmit).rows))?(value as RouteSubmit).rows:[];
 const allowed=new Map(plan.recipients.map(t=>[t.threadId,t]));
 return plan.rows.map((row,index)=>{
  const got=raw.find(r=>r&&r.index===index);
  const text=typeof got?.text==='string'?got.text.trim().slice(0,MAX_TEXT):row.quote;
  const threadId=typeof got?.threadId==='string'?got.threadId:row.threadId;
  if(row.blocked)return {index,threadId:null,text,send:false,reason:row.blocked};
  if(!got||got.send!==true)return {index,threadId,text,send:false,reason:'unchecked'};
  if(!threadId)return {index,threadId:null,text,send:false,reason:'no thread'};
  if(noSend.includes(threadId))return {index,threadId:null,text,send:false,reason:'coordinator is excluded'};
  if(!allowed.has(threadId))return {index,threadId:null,text,send:false,reason:'recipient outside the plan'};
  if(!text)return {index,threadId,text,send:false,reason:'empty text'};
  return {index,threadId,text,send:true};
 });
}

const short=(s:string,n=80)=>{const one=s.replace(/\s+/g,' ').trim();return one.length>n?one.slice(0,n-1)+'…':one;};
const DELIVERY_TEXT:Record<RouteDelivery,string>={sent:'sent',queued:'queued because the thread was busy',failed:'failed',skipped:'skipped',blocked:'blocked'};

/** Заголовок строки в ленте треда-источника. */
export function timelineTitle(rows:Pick<RouteResultRow,'name'|'delivery'>[],lang=DEFAULT_LANGUAGE){
 const tr=translator(lang);
 const names=[...new Set(rows.filter(r=>r.delivery==='sent'||r.delivery==='queued').map(r=>r.name))];
 return names.length?tr('route_delivered',names.join(', ')).slice(0,80):tr('route_none_delivered');
}

/** Итог агенту-источнику: кому что ушло и что нет. */
export function sourceSummary(entry:Pick<RouteLogEntry,'outcome'|'rows'|'reason'>){
 if(entry.outcome==='cancelled')return `The user did not confirm routing${entry.reason&&entry.reason!=='user'?` (${reasonText(entry.reason)})`:''}. No messages were sent. Continue your assigned work.`;
 if(entry.outcome==='interrupted')return 'Routing was interrupted when the plugin restarted. No messages were sent.';
 if(entry.outcome==='empty')return 'No excerpts had recipients. Tell the user who should receive them and continue your assigned work.';
 const ok=entry.rows.filter(r=>r.delivery==='sent'||r.delivery==='queued');
 const bad=entry.rows.filter(r=>r.delivery==='failed');
 const left=entry.rows.filter(r=>r.delivery==='skipped'||r.delivery==='blocked');
 const lines=[ok.length?'Routed:':'No messages routed.'];
 for(const r of ok)lines.push(`- ${r.name} («${short(r.title,50)}»): «${short(r.text)}»${r.delivery==='queued'?', queued':''}`);
 for(const r of bad)lines.push(`- could not reach ${r.name}: ${r.error??'send failed'}`);
 if(left.length)lines.push(`Unsent: ${left.length} ${left.length===1?'excerpt':'excerpts'} (${[...new Set(left.map(r=>r.error??DELIVERY_TEXT[r.delivery]))].join(', ')}).`);
 lines.push('The recipients own these excerpts. Continue your assigned work.');
 return lines.join('\n');
}
function reasonText(r:string){return ({timeout:'the form timed out after 30 minutes','thread-stopped':'thread stopped','thread-deleted':'thread deleted','plugin-disposed':'plugin restarted','server-restarted':'BB restarted','request-aborted':'request aborted'} as Record<string,string>)[r]??r;}
function plural(n:number,one:string,few:string,many:string){const m10=n%10,m100=n%100;return m10===1&&m100!==11?one:m10>=2&&m10<=4&&(m100<12||m100>14)?few:many;}

/** Подробности строки ленты: Markdown, без полных текстов. */
export function timelineDetail(rows:RouteResultRow[]){
 return rows.map(r=>`- ${r.name}: «${short(r.text,60)}», ${r.error??DELIVERY_TEXT[r.delivery]}`).join('\n').slice(0,1500);
}

/** Журнал разносов треда: новые сверху, не больше LOG_LIMIT, тексты укорочены. */
export function appendLog(log:RouteLogEntry[]|null|undefined,entry:RouteLogEntry):RouteLogEntry[]{
 const slim={...entry,rows:entry.rows.map(r=>({...r,text:short(r.text,300),title:short(r.title,80)}))};
 return [slim,...(log??[]).filter(e=>e.id!==entry.id)].slice(0,LOG_LIMIT);
}

