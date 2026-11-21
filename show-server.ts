// Настоящий прогон для показа. Плагин сам заводит треды агентов в проекте «Demo: Breeze Coffee»,
// по одному на шаг цепочки, передаёт сданное следующему и останавливает всё по кнопке, потолку денег или времени.
// Внешних действий нет: агенты читают и пишут только файлы демо-папки.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {DEFAULT_LANGUAGE,translator,type Language} from './i18n';
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {availableProviders,roleExecution} from './compat';
import {SHOW_BRAINS,SHOW_PROJECT_NAME,SHOW_STEPS,SHOW_STEP_TIMEOUT_MS,SHOW_TOTAL_TIMEOUT_MS,handoffLine,newRun,readySteps,runFinished,showPrompt,showThreadTitle,startLine,stepDef,sumCost,type ShowRun,type ShowStepDef} from './show';

const RUN_KEY='show:run';
const stepSchema=z.object({status:z.enum(['todo','working','waiting','done','error','stopped']),threadId:z.string().optional(),startedAt:z.number().optional(),endedAt:z.number().optional(),text:z.string().optional(),costUsd:z.number().optional(),error:z.string().optional()});
export const showRunSchema=z.object({id:z.string(),projectId:z.string(),dir:z.string(),startedAt:z.number(),endedAt:z.number().optional(),state:z.enum(['running','done','stopped','error','budget']),why:z.string().optional(),budgetUsd:z.number(),costUsd:z.number(),costKnown:z.boolean(),
 steps:z.record(z.string(),stepSchema),log:z.array(z.object({at:z.number(),text:z.string(),from:z.string().optional(),to:z.string().optional()})),poster:z.string().nullable().optional()});
export const showRpc={
 showState:{input:z.null(),output:z.object({run:showRunSchema.nullable(),projectId:z.string().nullable(),projectName:z.string()})},
 showStart:{input:z.null(),output:showRunSchema},
 showStop:{input:z.null(),output:showRunSchema.nullable()},
};
type CardOf=(key:string)=>Promise<{id:string;name:string;role:string}|null>;
const short=(e:unknown)=>String((e as Error)?.message??e).slice(0,300);

export function registerShow(bb:BbPluginApi,opts:{cardOf:CardOf;getLanguage?:()=>Promise<Language>;now?:()=>number;tickMs?:number;readPoster?:(path:string)=>string|null}){
 const now=opts.now??Date.now;
 const language=async()=>await opts.getLanguage?.()??DEFAULT_LANGUAGE;
 let run:ShowRun|null=null;let loaded=false;let disposed=false;let chain:Promise<unknown>=Promise.resolve();
 const warn=(e:unknown)=>{try{bb.log.warn('[cyber-office show] '+short(e));}catch{/* лог недоступен */}};
 /** Все изменения прогона по очереди: события idle и таймер не наступают друг на друга. */
 function serial<T>(fn:()=>Promise<T>):Promise<T>{const p=chain.then(fn,fn);chain=p.catch(()=>{});return p;}
 const readPoster=opts.readPoster??((p:string)=>{try{const s=readFileSync(p,'utf8');return /<svg[\s>]/i.test(s)&&s.length<400_000?s:null;}catch{return null;}});
 async function load(){if(!loaded){const p=showRunSchema.safeParse(await bb.storage.kv.get(RUN_KEY));run=p.success?p.data:null;loaded=true;}return run;}
 async function save(){if(!run)return;await bb.storage.kv.set(RUN_KEY,run);try{bb.realtime.publish('show-changed',{runId:run.id,state:run.state});}catch{/* нет realtime */}}

 async function project():Promise<{id:string;path:string|null}|null>{
  const list=await bb.sdk.projects.list() as {id:string;name:string;sources?:{path?:string|null;isDefault?:boolean}[]}[];
  const p=list.find(x=>x.name===SHOW_PROJECT_NAME);if(!p)return null;
  const src=p.sources?.find(s=>s.isDefault)??p.sources?.[0];
  return {id:p.id,path:src?.path??null};
 }
 async function costOf(threadId:string):Promise<number|undefined>{
  try{const c=await bb.sdk.threads.context({threadId});const cost=c?.usage?.cost;if(cost&&/usd/i.test(cost.currency))return cost.amount;}catch{/* стоимость не прочитана */}
  return undefined;
 }
 async function spawn(s:ShowStepDef){
  if(!run)return;
  const tr=translator(await language());
  const card=await opts.cardOf(s.roleId);const role={name:card?.name??s.roleId,role:card?.role??''};
  const parent=s.id==='plan'?undefined:run.steps.plan.threadId;
  const st=run.steps[s.id];st.status='working';st.startedAt=now();
  try{
   const providers=await availableProviders(bb);
   const execution=await roleExecution(bb,run.projectId,{provider:SHOW_BRAINS.providerId,providerId:SHOW_BRAINS.providerId,model:SHOW_BRAINS.model,modelId:SHOW_BRAINS.model,effort:''},providers?.has(SHOW_BRAINS.providerId));
   if(!execution)throw new Error(tr('show_provider_needed'));
   const t=await bb.sdk.threads.spawn({projectId:run.projectId,environment:{type:'project-default'},providerId:execution.providerId,...(execution.model?{model:execution.model}:{}),permissionMode:'accept-edits',
    ...(parent?{parentThreadId:parent}:{}),title:showThreadTitle(s,DEFAULT_LANGUAGE,card?.name),prompt:showPrompt(s,run,role),pluginMetadata:{show:{run:run.id,step:s.id}}} as Parameters<typeof bb.sdk.threads.spawn>[0]);
   st.threadId=t.id;await bb.storage.kv.set('role:'+t.id,s.roleId);
  }catch(e){st.status='error';st.error=short(e);st.endedAt=now();await finish('error',tr('show_thread_open_failed',tr(s.title),short(e)));}
 }
 /** Запускает всё, что готово. Один шаг Стаса пишет в журнал раздачу. */
 async function advance(){
  if(!run||run.state!=='running')return;
  const lang=await language();
  if(runFinished(run)){await finish('done',translator(lang)('show_finished'));return;}
  const ready=readySteps(run);if(!ready.length)return;
  if(ready[0].id!=='plan')run.log.push(startLine(ready,now(),lang));
  for(const s of ready)await spawn(s);
  await save();
 }
 async function stopThreads(){
  if(!run)return;
  for(const s of SHOW_STEPS){const st=run.steps[s.id];if(st.status!=='working'&&st.status!=='waiting')continue;
   if(st.threadId)try{await bb.sdk.threads.stop({threadId:st.threadId});}catch(e){warn(e);}
   st.status='stopped';st.endedAt=now();}
 }
 async function finish(state:ShowRun['state'],why:string){
  if(!run||run.state!=='running')return;
  if(state!=='done')await stopThreads();
  run.state=state;run.why=why;run.endedAt=now();
  const tr=translator(await language());
  run.log.push({at:now(),text:state==='done'?tr('stas_is_waiting_for_your_approval'):tr('show_interrupted',why)});
  await save();
 }
 async function recount(){
  if(!run)return;
  for(const s of SHOW_STEPS){const st=run.steps[s.id];if(st.threadId&&(st.status==='working'||st.status==='waiting'||st.status==='done'&&st.costUsd==null)){const c=await costOf(st.threadId);if(c!=null)st.costUsd=c;}}
  const c=sumCost(run);run.costUsd=c.usd;run.costKnown=c.known;
 }
 async function onDone(stepId:string,text:string|null){
  if(!run||run.state!=='running')return;
  const s=stepDef(stepId)!;const st=run.steps[stepId];if(st.status!=='working'&&st.status!=='waiting')return;
  st.status='done';st.endedAt=now();st.text=(text??'').slice(0,4000);
  const lang=await language();const tr=translator(lang);
  run.log.push(handoffLine(s,st.text,now(),lang));
  if(s.id==='poster'){const p=await project().catch(()=>null);if(p?.path)run.poster=readPoster(join(p.path,run.dir,s.file));}
  await recount();
  if(run.costUsd>run.budgetUsd){await finish('budget',tr('show_budget_reached',run.budgetUsd));return;}
  await save();await advance();
 }
 const stepOfThread=(threadId:string)=>run?SHOW_STEPS.find(s=>run!.steps[s.id].threadId===threadId):undefined;

 bb.events.on('thread.idle',({thread,lastAssistantText})=>serial(async()=>{
  await load();const s=stepOfThread(thread.id);if(!s)return;
  if((thread as {hasPendingInteraction?:boolean}).hasPendingInteraction){run!.steps[s.id].status='waiting';await save();return;}
  await onDone(s.id,lastAssistantText);
 }).catch(warn));
 bb.events.on('thread.failed',({thread,error}:{thread:{id:string};error?:string|null})=>serial(async()=>{
  await load();const s=stepOfThread(thread.id);if(!s||!run||run.state!=='running')return;
  const tr=translator(await language());
  const st=run.steps[s.id];st.status='error';st.error=error??tr('show_thread_error');st.endedAt=now();
  await finish('error',tr('show_step_error',tr(s.title),st.error));
 }).catch(warn));

 /** Страховка: стоимость, тайм-ауты, пропущенные события idle. */
 async function tick(){
  await load();if(!run||run.state!=='running')return;const at=now();const tr=translator(await language());
  await recount();
  if(run.costUsd>run.budgetUsd){await finish('budget',tr('show_budget_reached',run.budgetUsd));return;}
  if(at-run.startedAt>SHOW_TOTAL_TIMEOUT_MS){await finish('error',tr('show_total_timeout'));return;}
  for(const s of SHOW_STEPS){
   const st=run.steps[s.id];if(st.status!=='working'&&st.status!=='waiting'||!st.threadId)continue;
   try{
    const t=await bb.sdk.threads.get({threadId:st.threadId});
    if(t.status==='error'){st.status='error';st.error=tr('show_thread_error');await finish('error',tr('show_step_error',tr(s.title),st.error));return;}
    const pending=!!(t as {hasPendingInteraction?:boolean}).hasPendingInteraction;
    if(pending&&st.status!=='waiting'){st.status='waiting';run.log.push({at,from:s.roleId,to:'user',text:tr('show_step_permission',tr(s.title))});}
    if(t.status==='idle'&&!pending){const {output}=await bb.sdk.threads.output({threadId:st.threadId});await onDone(s.id,output??null);if(run.state!=='running')return;continue;}
   }catch(e){warn(e);}
   if(st.startedAt&&at-st.startedAt>SHOW_STEP_TIMEOUT_MS){await finish('error',tr('show_step_timeout',tr(s.title)));return;}
  }
  await save();
 }
 const timer=setInterval(()=>{if(!disposed)serial(tick).catch(warn);},opts.tickMs??5000);
 try{bb.onDispose(()=>{disposed=true;clearInterval(timer);});}catch{/* нет onDispose */}

 const handlers={
  async showState(){
   return serial(async()=>{await load();const p=await project().catch(()=>null);return {run,projectId:p?.id??null,projectName:SHOW_PROJECT_NAME};});
  },
  async showStart(){
   return serial(async()=>{
    await load();const lang=await language();const tr=translator(lang);if(run?.state==='running')throw new Error(tr('show_already_running'));
    const p=await project();if(!p)throw new Error(tr('show_project_missing',SHOW_PROJECT_NAME));
    const ids=[...new Set(SHOW_STEPS.map(s=>s.roleId))];
    const disabled=await Promise.all(ids.map(async id=>(await opts.cardOf(id))?null:id));
    if(disabled.some(Boolean))throw new Error(tr('show_disabled_roles',disabled.filter(Boolean).join(', ')));
    const at=now();const id=new Date(at).toISOString().slice(0,16).replace(/[-:]/g,'').replace('T','-');
    run=newRun(id,p.id,at,lang);await save();await advance();return run!;
   });
  },
  async showStop(){
   return serial(async()=>{await load();if(run?.state==='running')await finish('stopped',translator(await language())('stopped_by_the_user'));return run;});
  },
 };
 return {handlers,tick:()=>serial(tick)};
}
