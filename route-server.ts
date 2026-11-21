import {DEFAULT_LANGUAGE,translator,text,type Language} from './i18n';
// Разнос ответа по агентам: сервер. Подключение из server.ts:
//   import {routeRpc,registerRouteServer,ROUTE_TOOLS} from './route-server';
//   rpcContract: {...routeRpc}; handlers: {...registerRouteServer(bb)}; configure tools: [...ROUTE_TOOLS]
// Ничего не уходит в чужие треды без кнопки «Отправить» в форме.
import {defineRpcContract,type BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {logRoutePass} from './pass-log';
import roster from './team.json';
import {statusText,localizeRole,summarize,type Role,type RoleSummary,type Thread} from './model';
import {FORM_TIMEOUT_MS,MAX_PIECES,MAX_TEXT,NO_SEND,appendLog,blockReason,buildPlan,recipientMessage,resolveSubmit,sourceSummary,splitMessage,targetsOf,timelineDetail,timelineTitle,type RouteLogEntry,type RouteOrigin,type RoutePiece,type RoutePlan,type RouteResultRow} from './route';

export const ROUTE_FORM_ID='route-form';
export const ROUTE_TOOLS=['team_route','team_threads'] as const;
export const ROUTE_LOG_EVENT='route-log';
const PLAN_KEY='route-plan:';
const LOG_KEY='route:';

const deliverySchema=z.enum(['sent','queued','failed','skipped','blocked']);
const logEntrySchema=z.object({id:z.string(),at:z.number(),sourceThreadId:z.string(),origin:z.enum(['tool','manual','forward']),outcome:z.enum(['sent','cancelled','interrupted','empty']),reason:z.string().optional(),
 rows:z.array(z.object({index:z.number(),threadId:z.string().nullable(),name:z.string(),title:z.string(),text:z.string(),delivery:deliverySchema,error:z.string().optional()}))});
export const routeRpc={
 /** Ручная кнопка «Разнести по агентам»: строит план и открывает форму, ответа формы не ждёт. */
 planRoute:{input:z.object({threadId:z.string().min(1),role:z.enum(['user','assistant']),text:z.string().max(20000),selectedText:z.string().max(20000).optional()}).strict(),
  output:z.object({started:z.boolean(),planId:z.string().nullable(),rows:z.number().int(),sendable:z.number().int(),error:z.string().nullable()})},
 /** Журнал разносов треда, новые сверху. */
 routeLog:{input:z.object({threadId:z.string().min(1)}).strict(),output:z.array(logEntrySchema)},
};
export const routeRpcContract=defineRpcContract(routeRpc);
type Handlers={[K in keyof typeof routeRpc]:(input:z.infer<(typeof routeRpc)[K]['input']>)=>Promise<z.infer<(typeof routeRpc)[K]['output']>>};

const pieceSchema=z.object({
 to:z.string().min(1).max(80).describe('Thread ID from team_threads, role (e.g. nora or designer), or "?" if unknown'),
 quote:z.string().min(1).max(MAX_TEXT).describe('Verbatim excerpt from the user’s message'),
 note:z.string().max(200).optional().describe('Up to 200 characters of context for the recipient'),
}).strict();
const ROUTE_INSTRUCTIONS=`Reply in the user's language

Users may cover several topics in one message. Route excerpts outside your assigned task to their owners.
1. Call team_threads if you need to look up assignees.
2. Call team_route with verbatim excerpts. Set the recipient to a thread ID, a role, or "?".
3. The user reviews the recipients and confirms sending. You receive a delivery summary.
Continue your assigned work while the form is open. Coordinator and test threads are excluded.`;

interface Options {cards?:(lang:Language)=>Promise<Role[]>;getLanguage?:()=>Promise<Language>;noSend?:readonly string[];now?:()=>number}
/** Что знаем о треде-источнике и команде его проекта. */
interface Scope {lang:Language;projectId:string;people:RoleSummary[];title:string;name:string}

export function registerRouteServer(bb:BbPluginApi,opts:Options={}):Handlers{
 const noSend=opts.noSend??NO_SEND;const now=opts.now??Date.now;const startedAt=now();
 const roles=roster.roles as Role[];
 const coordinators=roster.coordinatorByProject as Record<string,string>;

 /** Cyber Office проекта, где живёт тред: поднимаемся к корню, как getThreadCard. */
 async function scopeOf(threadId:string):Promise<Scope>{
  const self=await bb.sdk.threads.get({threadId});let root=self;const seen=new Set<string>();
  while(root.parentThreadId&&!seen.has(root.id)){seen.add(root.id);try{root=await bb.sdk.threads.get({threadId:root.parentThreadId});}catch{break;}}
  const projectId=root.projectId;
  const rows=new Map<string,Thread>();
  for(const args of [{projectId},{hasParent:true}]){
   for(let offset=0;offset<100000;offset+=200){
    const page=await bb.sdk.threads.list({...args,archived:false,includeHidden:false,limit:200,offset});
    for(const t of page)rows.set(t.id,{id:t.id,projectId:t.projectId,title:t.title,status:t.status,provider:t.providerId,hidden:t.visibility==='hidden',hasPendingInteraction:t.hasPendingInteraction,parentThreadId:t.parentThreadId,pinnedAt:t.pinnedAt,lastReadAt:t.lastReadAt,latestAttentionAt:t.latestAttentionAt,createdAt:t.createdAt,titleFallback:t.titleFallback});
    if(page.length<200)break;
   }
  }
  const bindings:Record<string,string>={};
  await Promise.all([...rows.keys()].map(async id=>{const r=await bb.storage.kv.get<string>('role:'+id);if(r)bindings[id]=r;}));
  const lang=await opts.getLanguage?.()??DEFAULT_LANGUAGE;
  const {team,interns}=summarize(opts.cards?await opts.cards(lang):roles.map(r=>localizeRole(r,lang)),[...rows.values()],projectId,bindings,coordinators,lang);
  const people=[...team,...interns];
  const who=people.find(p=>p.threads.some(t=>t.id===threadId));
  return {lang,projectId,people,title:(self.title??self.titleFallback??'').replace(/^\[[^\]]+\]\s*/,'').trim()||translator(lang)('untitled'),name:who?.name??translator(lang)('route_agent')};
 }
 /** Последние сообщения пользователя в треде: для метки «не дословно». */
 async function stasTexts(threadId:string):Promise<string[]>{
  try{
   const list=await bb.sdk.threads.promptHistory({threadId,limit:'5'});
   return [...list].sort((a,b)=>b.createdAt-a.createdAt).slice(0,3).map(p=>p.input.map(i=>i.type==='text'?i.text:'').join('\n'));
  }catch(e){bb.log?.warn?.('[cyber-office route] promptHistory: '+String(e));return [];}
 }
 async function makePlan(sourceThreadId:string,pieces:RoutePiece[],origin:RouteOrigin,texts?:string[]):Promise<RoutePlan>{
  const scope=await scopeOf(sourceThreadId);
  return buildPlan({id:now().toString(36)+Math.random().toString(36).slice(2,7),sourceThreadId,sourceTitle:scope.title,sourceName:scope.name,projectId:scope.projectId,origin,createdAt:now(),
   pieces,people:scope.people,stasTexts:texts??await stasTexts(sourceThreadId),noSend},scope.lang);
 }
 async function log(entry:RouteLogEntry){
  const key=LOG_KEY+entry.sourceThreadId;
  await bb.storage.kv.set(key,appendLog(await bb.storage.kv.get<RouteLogEntry[]>(key),entry));
  bb.realtime.publish(ROUTE_LOG_EVENT,{threadId:entry.sourceThreadId});
 }
 /** Отправка строк, которые вы подтвердил. Каждый получатель проверяется заново. */
 async function deliver(plan:RoutePlan,value:unknown):Promise<RouteResultRow[]>{
  const out:RouteResultRow[]=[];
  const lang=await opts.getLanguage?.()??DEFAULT_LANGUAGE;
  for(const r of resolveSubmit(plan,value,noSend)){
   const target=plan.recipients.find(t=>t.threadId===r.threadId);
   const base={index:r.index,threadId:r.threadId,name:target?.name??'—',title:target?.title??'',text:r.text};
   if(!r.send||!r.threadId){out.push({...base,delivery:plan.rows[r.index].blocked?'blocked':'skipped',error:r.reason});continue;}
   try{
    // The title may have changed since the plan: re-check the bans right before writing.
    const fresh=await bb.sdk.threads.get({threadId:r.threadId});
    const ban=blockReason(fresh,noSend);if(ban){out.push({...base,delivery:'blocked',error:ban});continue;}
    const row=plan.rows[r.index];
    const res=await bb.sdk.threads.send({threadId:r.threadId,input:[{type:'text',text:recipientMessage({sourceTitle:plan.sourceTitle,sourceName:plan.sourceName,text:r.text,quote:row.quote,note:row.note,verbatim:row.verbatim,origin:plan.origin},lang)}],mode:'queue-if-active',senderThreadId:plan.sourceThreadId} as Parameters<typeof bb.sdk.threads.send>[0]);
    out.push({...base,delivery:(res as {delivery?:string}).delivery==='queued'?'queued':'sent'});
    await logRoutePass(bb,plan,target,r.threadId,now());
   }catch(e){out.push({...base,delivery:'failed',error:String((e as Error)?.message??e).slice(0,200)});}
  }
  return out;
 }
 /**
  * План в kv до формы, форма, отправка после «Отправить», журнал.
  * Возвращает запись журнала; агенту-источнику её пересказывает вызывающий.
  */
 async function runForm(plan:RoutePlan,signal?:AbortSignal):Promise<RouteLogEntry>{
  const lang=await opts.getLanguage?.()??DEFAULT_LANGUAGE;const tr=translator(lang);
  await bb.storage.kv.set(PLAN_KEY+plan.id,plan);
  let entry:RouteLogEntry;
  try{
   const res=await bb.ui.requestInput({threadId:plan.sourceThreadId,rendererId:ROUTE_FORM_ID,title:tr('route_to_agents'),payload:plan as never,timeoutMs:FORM_TIMEOUT_MS,
    presentation:{label:{pending:tr('route_pending'),completed:tr('route_confirmed')}},
    describeSubmission:v=>{
     const rows=resolveSubmit(plan,v,noSend).filter(r=>r.send).map(r=>({name:plan.recipients.find(t=>t.threadId===r.threadId)?.name??'—',delivery:'sent' as const}));
     return {title:timelineTitle(rows,lang)};
    }},signal?{signal}:undefined);
   const stored=(await bb.storage.kv.get<RoutePlan>(PLAN_KEY+plan.id))??plan;
   entry=res.outcome==='submitted'
    ?{id:plan.id,at:now(),sourceThreadId:plan.sourceThreadId,origin:plan.origin,outcome:'sent',rows:await deliver(stored,res.value)}
    :{id:plan.id,at:now(),sourceThreadId:plan.sourceThreadId,origin:plan.origin,outcome:'cancelled',reason:res.reason,rows:[]};
  }catch(e){
   entry={id:plan.id,at:now(),sourceThreadId:plan.sourceThreadId,origin:plan.origin,outcome:'cancelled',reason:String((e as Error)?.message??e).slice(0,200),rows:[]};
  }finally{await bb.storage.kv.delete(PLAN_KEY+plan.id);}
  await log(entry);
  return entry;
 }
 // A reload drops the waiting promise: plans left in kv from before this start are logged as interrupted.
 void (async()=>{
  try{
   for(const key of await bb.storage.kv.list()){
    if(!key.startsWith(PLAN_KEY))continue;
    const plan=await bb.storage.kv.get<RoutePlan>(key);
    if(plan&&plan.createdAt>=startedAt)continue;
    await bb.storage.kv.delete(key);
    if(plan)await log({id:plan.id,at:now(),sourceThreadId:plan.sourceThreadId,origin:plan.origin,outcome:'interrupted',rows:[]});
   }
  }catch(e){bb.log?.warn?.('[cyber-office route] cleanup: '+String(e));}
 })();

 bb.agents.registerTool({name:'team_threads',
  description:'List active project threads for team_route, with assignee, role, title, and status. Excludes test threads and the coordinator.',
  parameters:z.object({}).strict(),
  presentation:{label:{pending:text('route_scanning'),completed:text('route_threads')},suppress:true},
  async execute(_p,ctx){
   const scope=await scopeOf(ctx.threadId);
   const {allowed,blocked}=targetsOf(scope.people,ctx.threadId,noSend,scope.lang);
   return JSON.stringify({threads:allowed.map(t=>({threadId:t.threadId,who:t.name,roleId:t.roleId,role:t.role,title:t.title,status:statusText(t.status,scope.lang),intern:t.intern||undefined})),hidden:blocked.length});
  }});
 bb.agents.registerTool({name:'team_route',
  description:'Route verbatim excerpts from the user’s message to other roles for the user to confirm.',
  instructions:ROUTE_INSTRUCTIONS,
  parameters:z.object({pieces:z.array(pieceSchema).min(1).max(MAX_PIECES)}).strict(),
  presentation:{label:{pending:text('route_preparing'),completed:text('route_routing')}},
  async execute({pieces},ctx){
   const ban=blockReason(await bb.sdk.threads.get({threadId:ctx.threadId}),noSend);
   if(ban)return {content:[{type:'text',text:`Routing is unavailable here: ${ban}.`}],isError:true};
   const plan=await makePlan(ctx.threadId,pieces,'tool');
   const entry=await runForm(plan,ctx.signal);
   return sourceSummary(entry);
  }});

 return {
  async planRoute({threadId,role,text,selectedText}){
   try{
    const lang=await opts.getLanguage?.()??DEFAULT_LANGUAGE;const tr=translator(lang);
    const ban=blockReason(await bb.sdk.threads.get({threadId}),noSend,lang);
    if(ban)return {started:false,planId:null,rows:0,sendable:0,error:tr('route_unavailable',ban)};
    const body=(selectedText??text).trim();
    if(!body)return {started:false,planId:null,rows:0,sendable:0,error:tr('route_empty_message')};
    const origin:RouteOrigin=role==='user'?'manual':'forward';
    const pieces:RoutePiece[]=origin==='manual'?splitMessage(body).map(quote=>({to:'?',quote})):[{to:'?',quote:body}];
    const plan=await makePlan(threadId,pieces,origin,origin==='manual'?[text]:[]);
    const sendable=plan.rows.filter(r=>!r.blocked&&r.threadId).length;
    // Do not wait for the user here: the form answers later, the result goes to kv and to the source agent.
    void runForm(plan).then(async entry=>{
     if(entry.outcome!=='sent'||!entry.rows.some(r=>r.delivery==='sent'||r.delivery==='queued'))return;
     try{await bb.sdk.threads.send({threadId,input:[{type:'text',text:'[Cyber Office] '+sourceSummary(entry)}],mode:'queue-if-active'} as Parameters<typeof bb.sdk.threads.send>[0]);}
     catch(e){bb.log?.warn?.('[cyber-office route] итог источнику: '+String(e));}
    }).catch(e=>bb.log?.warn?.('[cyber-office route] форма: '+String(e)));
    return {started:true,planId:plan.id,rows:plan.rows.length,sendable,error:null};
   }catch(e){return {started:false,planId:null,rows:0,sendable:0,error:String((e as Error)?.message??e)};}
  },
  async routeLog({threadId}){return (await bb.storage.kv.get<RouteLogEntry[]>(LOG_KEY+threadId))??[];},
 };
}

