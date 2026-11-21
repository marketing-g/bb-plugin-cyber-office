import {withBoardLock} from './board-lock';
import {defineRpcContract,type BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import roster from './team.json';
import chains from './chains.json';
import {LANGUAGES,DEFAULT_LANGUAGE,languageOf,dataText,localizeChains,translator,type Language} from './i18n';
import {availableProviders,roleExecution,Health,SERVER_NEEDS,offHandler,type FeatureState} from './compat';
import {routeRpc,registerRouteServer,ROUTE_TOOLS} from './route-server';
import {registerAskServer,ASK_TOOLS} from './ask-server';
import {itogRulesFor} from './itog-rules';
import {dispatchRpc,registerDispatch} from './dispatch-server';
import {foremanRpc,registerForeman} from './foreman-server';
import {passRpc,registerPassServer} from './pass-log';
import {scoutRpc,registerScout} from './scout-server';
import {showRpc,registerShow} from './show-server';
import {customRole,localizeRole,roleForKey,roleInputError,summarize,threadStatus,type Role,type RolePatch,type Thread} from './model';
import {STAGES} from './flow';
import {LOOKS} from './sprites';
import {SKILL_CATEGORIES,SKILL_ORIGINS} from './skill-categories';
import {createSkillCatalog,readInstalledSkills,SKILL_CATALOG_LIMIT} from './skill-catalog';
const projectInput=z.object({projectId:z.string().min(1)}).strict();
const baseRoles=roster.roles as Role[];
/** RPC results must be JSON: drop fields the host left undefined. */
function defined<T extends object>(o:T):T{return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined)) as T;}
const brainsSchema=z.object({provider:z.string(),providerId:z.string().optional(),model:z.string(),modelId:z.string().optional(),effort:z.string()});
const threadSchema=z.object({id:z.string(),projectId:z.string(),title:z.string().nullable(),status:z.string(),provider:z.string(),hasPendingInteraction:z.boolean().optional(),parentThreadId:z.string().nullable().optional(),pinnedAt:z.number().nullable().optional(),hidden:z.boolean().optional(),lastReadAt:z.number().nullable().optional(),latestAttentionAt:z.number().nullable().optional(),createdAt:z.number().nullable().optional(),titleFallback:z.string().nullable().optional(),roleId:z.string().optional(),handoffTo:z.string().optional(),execution:z.object({model:z.string(),reasoningLevel:z.string()}).nullable().optional(),executionError:z.string().optional()});
const appearance={name:z.string().trim(),enabled:z.boolean(),look:z.enum(['base','a','b','c']),glow:z.string().regex(/^#[0-9a-f]{6}$/i)};
const stageSchema=z.enum(STAGES.map(s=>s.id));
const roleFields={enabled:appearance.enabled.optional(),look:appearance.look.optional(),glow:appearance.glow.optional(),providerAvailable:z.boolean().optional(),id:z.string(),name:z.string(),role:z.string(),brains:brainsSchema,hands:z.array(z.string()),skills:z.array(z.string()),takesFrom:z.array(z.string()),givesTo:z.array(z.string()),callsUser:z.string(),customized:z.boolean().optional(),intern:z.boolean().optional(),custom:z.boolean().optional(),stage:stageSchema.optional(),avatar:z.string().optional()};
const roleCardSchema=z.object(roleFields);
const roleSchema=z.object({...roleFields,status:z.enum(['waiting','error','working','delivered','free']),threads:z.array(threadSchema),current:threadSchema.nullable()});
const patchSchema=z.object({name:appearance.name.optional(),enabled:appearance.enabled.optional(),look:appearance.look.optional(),glow:appearance.glow.optional(),brains:brainsSchema.optional(),hands:z.array(z.string().min(1).max(80)).max(20).optional(),skills:z.array(z.string().min(1).max(80)).max(20).optional(),role:z.string().trim().optional(),stage:stageSchema.optional(),avatar:z.string().refine(id=>Object.hasOwn(LOOKS,id)).optional(),callsUser:z.string().trim().optional()}).strict();
const CUSTOM_ROLES='custom-roles';
interface ChainStep {id:string;title:string;role:string;output:string;needsUser:boolean;children?:ChainStep[]}
const stepSchema:z.ZodType<ChainStep>=z.lazy(()=>z.object({id:z.string(),title:z.string(),role:z.string(),output:z.string(),needsUser:z.boolean(),children:z.array(stepSchema).optional()}));
const chainsSchema=z.object({blocks:z.array(z.object({id:z.string(),title:z.string(),steps:z.array(stepSchema)}))});
const personSchema=z.object({id:z.string(),name:z.string(),role:z.string(),intern:z.boolean().optional()});
const threadCardSchema=z.object({
 thread:threadSchema,status:z.enum(['waiting','error','working','delivered','free']),
 who:personSchema,handoff:personSchema.nullable(),
 parent:z.object({id:z.string(),title:z.string().nullable(),who:personSchema.nullable()}).nullable(),
 children:z.array(z.object({thread:threadSchema,status:z.enum(['waiting','error','working','delivered','free']),who:personSchema})),
 projectId:z.string(),
});
export const rpcContract=defineRpcContract({
 getTeam:{input:projectInput,output:z.object({team:z.array(roleSchema),interns:z.array(roleSchema),waiting:z.number().int().nonnegative(),fetchedAt:z.number(),coordinatorThreadId:z.string().nullable()})},
 getLanguage:{input:z.null(),output:z.enum(LANGUAGES)},
 setLanguage:{input:z.enum(LANGUAGES),output:z.enum(LANGUAGES)},
 getRoster:{input:z.null(),output:z.array(roleCardSchema)},
 getSkillCatalog:{input:z.object({projectId:z.string().min(1).optional()}).strict(),output:z.array(z.object({
  name:z.string(),description:z.string(),origin:z.enum(SKILL_ORIGINS),category:z.enum(SKILL_CATEGORIES),
 })).max(SKILL_CATALOG_LIMIT)},
 getExperiments:{input:z.null(),output:z.boolean()},
 setExperiments:{input:z.boolean(),output:z.boolean()},
 getThreadCard:{input:z.object({threadId:z.string().min(1)}).strict(),output:threadCardSchema.nullable()},
 getChains:{input:z.null(),output:chainsSchema},
 getRole:{input:z.object({roleId:z.string().min(1)}).strict(),output:z.object({card:roleCardSchema,defaults:roleCardSchema})},
 updateRole:{input:z.object({roleId:z.string().min(1).nullable(),patch:patchSchema}).strict(),output:roleCardSchema},
 resetRole:{input:z.object({roleId:z.string().min(1)}).strict(),output:roleCardSchema},
 deleteRole:{input:z.object({roleId:z.string().min(1)}).strict(),output:z.null()},
 ...routeRpc,
 ...dispatchRpc,
 ...foremanRpc,
 ...passRpc,
 ...scoutRpc,
 ...showRpc,
 /** Какие куски плагина включились: для проверки после обновления BB. */
 health:{input:z.null(),output:z.object({features:z.array(z.object({id:z.string(),ok:z.boolean(),error:z.string().optional()})),indexedThreads:z.number().int()})},
});
const TEAM_PROJECTS=Object.keys(roster.coordinatorByProject);
export default function plugin(bb:BbPluginApi){
 const health=new Health(msg=>{try{bb.log?.warn?.(msg);}catch{/* лог недоступен */}});
 const skillCatalog=createSkillCatalog({read:projectId=>readInstalledSkills(bb.sdk,projectId)});
 // Память сервера: заголовок и корневой проект каждого треда команды. Правила итога
 // читают её синхронно, чтобы пропустить «Тест:» и дать правила дочерним тредам в других проектах.
 const index=new Map<string,{title:string|null;projectId:string;parent:string|null}>();
 const rootProject=(id:string)=>{let cur=index.get(id);const seen=new Set<string>();while(cur?.parent&&!seen.has(cur.parent)){seen.add(cur.parent);const up=index.get(cur.parent);if(!up)break;cur=up;}return cur?.projectId;};
 async function reindex(){
  const next=new Map<string,{title:string|null;projectId:string;parent:string|null}>();
  for(const args of [...TEAM_PROJECTS.map(projectId=>({projectId})),{hasParent:true}]){
   for(let offset=0;offset<20000;offset+=200){
    const page=await bb.sdk.threads.list({...args,archived:false,includeHidden:false,limit:200,offset});
    for(const t of page)next.set(t.id,{title:t.title??t.titleFallback??null,projectId:t.projectId,parent:t.parentThreadId??null});
    if(page.length<200)break;
   }
  }
  index.clear();for(const [k,v] of next)index.set(k,v);
 }
 health.run('thread-index',bb,SERVER_NEEDS['thread-index'],()=>bb.background.service('thread-changes',{async start(signal){
  if(signal.aborted)return;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const later=()=>{if(timer)return;timer=setTimeout(()=>{timer=null;reindex().catch(e=>health.fail('thread-index',e));},3000);};
  const off=bb.sdk.subscribe({event:'thread:changed',callback:()=>{bb.realtime.publish('threads-changed',null);later();}});
  reindex().catch(e=>health.fail('thread-index',e));
  try{await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}finally{off();if(timer)clearTimeout(timer);}
 }}));
 const getLanguage=async()=>languageOf(await bb.storage.kv.get<string>('language'));
 const errorText=async(value:string)=>dataText(await getLanguage(),value);
 let experiments=false;
 const experimentsReady=bb.storage.kv.get<boolean>('experiments').then(v=>{experiments=v===true;}).catch(()=>{});
 const experimental=async()=>{await experimentsReady;return experiments;};
 const gated=<P,R>(handler?: (p:P)=>Promise<R>,fallback?:()=>Promise<R>,feature?:FeatureState["id"])=>async(p:P)=>{
  if(await experimental()){
   if(handler)return handler(p);
   if(feature)return offHandler(feature,health,getLanguage)();
  }
  if(fallback)return fallback();
  throw new Error(await errorText('Экспериментальные функции выключены'));
 };
 async function roleSettings(){
  const [patches,custom]=await Promise.all([
   Promise.all(baseRoles.map(r=>bb.storage.kv.get<RolePatch>('override:'+r.id))),
   bb.storage.kv.get<Record<string,RolePatch>>(CUSTOM_ROLES),
  ]);
  return {custom:custom??{},entries:[
   ...baseRoles.map((base,i)=>({base,patch:patches[i]})),
   ...Object.entries(custom??{}).map(([id,patch])=>({base:customRole(id),patch})),
  ]};
 }
 function localizedCards(entries:Awaited<ReturnType<typeof roleSettings>>['entries'],lang:Language){
  const displayNames=new Map(entries.filter(({base})=>!base.custom).map(({base,patch})=>[base.name,patch?.name??dataText(lang,base.name)]));
  return entries.map(({base,patch})=>localizeRole(base,lang,patch,name=>displayNames.get(name)??dataText(lang,name)));
 }
 async function cards(lang:Language){
  const [{entries},providers]=await Promise.all([roleSettings(),availableProviders(bb)]);
  return localizedCards(entries,lang).map(r=>providers&&r.brains.providerId?{...r,providerAvailable:providers.has(r.brains.providerId)}:r);
 }
 async function officeRoles(lang?:Language){
  const [roles,enabled]=await Promise.all([cards(lang??await getLanguage()),experimental()]);
  return roles.map(r=>r.id==='radar'&&!enabled?{...r,enabled:false}:r);
 }
 async function configuredRole(key:string,lang?:Language){
  const roles=await officeRoles(lang);
  return roles.find(r=>r.id===key)??roleForKey(roles.filter(r=>r.enabled!==false),key)??null;
 }
 async function read(projectId:string,lang:Language){
  const rows=new Map<string,Thread>();
  // The coordinator can start a child in another project (the site checkout),
  // so every child thread is read and summarize keeps the ones under this project.
  for(const args of [{projectId},{hasParent:true}]){
   for(let offset=0;;offset+=200){
    if(offset>=100000)throw new Error(dataText(lang,'Слишком много тредов: сводка не усечена молча'));
    const page=await bb.sdk.threads.list({...args,archived:false,includeHidden:false,limit:200,offset});
    for(const t of page)rows.set(t.id,defined({id:t.id,projectId:t.projectId,title:t.title,status:t.status,provider:t.providerId,hidden:t.visibility==='hidden',hasPendingInteraction:t.hasPendingInteraction,parentThreadId:t.parentThreadId,pinnedAt:t.pinnedAt,lastReadAt:t.lastReadAt,latestAttentionAt:t.latestAttentionAt,createdAt:t.createdAt,titleFallback:t.titleFallback}));
    if(page.length<200)break;
   }
  }
  const bindings:Record<string,string>={};
  await Promise.all([...rows.values()].map(async t=>{const r=await bb.storage.kv.get<string>('role:'+t.id);if(r)bindings[t.id]=r;}));
  // После смены караула настоящего координатора офис показывает новую смену.
  const coordinators={...roster.coordinatorByProject as Record<string,string>};
  const moved=await experimental()?await dispatch?.coordinatorOverride(projectId).catch(()=>null):null;if(moved)coordinators[projectId]=moved;
  const result=summarize(await officeRoles(lang),[...rows.values()],projectId,bindings,coordinators,lang);
  // Read only the current task of each role. A failed optional read never hides the roster.
  await Promise.all(result.team.map(async role=>{
   if(!role.current)return;
   try{role.current.execution=await bb.sdk.threads.defaultExecutionOptions({threadId:role.current.id});}
   catch{role.current.executionError=dataText(lang,'Настройки треда не прочитаны');}
  }));
  return result;
 }
 // Диспетчер: доска Стаса и смена караула. Включается только тредам из списка, координатор по умолчанию выключен.
 const dispatch=health.run('dispatch',bb,SERVER_NEEDS.dispatch,()=>registerDispatch(bb,{cardOf:async key=>{const r=await configuredRole(key);return r?.enabled===false?null:r;},experimental,getLanguage}));
 const foreman=health.run('foreman',bb,SERVER_NEEDS.foreman,()=>registerForeman(bb,{saveBoard:dispatch?.saveBoard,experimental,getLanguage}));
 // Разнос: если BB убрал форму или отправку, RPC разноса честно отвечают «отключён», офис живёт.
 const scout=health.run('scout',bb,SERVER_NEEDS.scout,()=>registerScout(bb,{cardOf:async key=>{const r=await configuredRole(key);return r?.enabled===false?null:r;},experimental,saveBoard:dispatch?.saveBoard,getLanguage}));
 // Показ: настоящий прогон для гостей в отдельном проекте BB, дешёвые модели, потолок $2.
 const show=health.run('show',bb,SERVER_NEEDS.show,()=>registerShow(bb,{getLanguage,cardOf:async key=>{const r=await configuredRole(key,DEFAULT_LANGUAGE);return r?.enabled===false?null:r;}}));
 const route=health.run('route',bb,SERVER_NEEDS.route,()=>registerRouteServer(bb,{cards:officeRoles,getLanguage}));
 const pass=health.run('pass',bb,SERVER_NEEDS.pass,()=>registerPassServer(bb));
 health.run('ask',bb,SERVER_NEEDS.ask,()=>registerAskServer(bb,{getLanguage}));
 // Правила формата итога в инструкции новых тредов команды; координатор и «Тест:» без них.
 health.run('itog-rules',bb,SERVER_NEEDS['itog-rules'],()=>bb.agents.contributeInstructions(ctx=>{
  try{
   const projectId=rootProject(ctx.threadId)??ctx.projectId;
   return itogRulesFor({threadId:ctx.threadId,projectId},{titleOf:id=>index.get(id)?.title});
  }catch{return null;}
 }));
 health.run('office',bb,SERVER_NEEDS.office,()=>bb.rpc.register(rpcContract,{
  planRoute:route?.planRoute??offHandler('route',health,getLanguage),routeLog:route?.routeLog??(async()=>[]),
  getBoards:gated(dispatch?.handlers.getBoards,async()=>({boards:[]})),
  getPasses:pass?.getPasses??offHandler('pass',health,getLanguage),
  dispatcherStart:gated(dispatch?.handlers.dispatcherStart,undefined,'dispatch'),
  dispatcherEnable:gated(dispatch?.handlers.dispatcherEnable,undefined,'dispatch'),
  dispatcherDisable:gated(dispatch?.handlers.dispatcherDisable,undefined,'dispatch'),
  dispatcherStatus:gated(dispatch?.handlers.dispatcherStatus,undefined,'dispatch'),
  boardImport:gated(dispatch?.handlers.boardImport,undefined,'dispatch'),
  foremanEnable:gated(foreman?.handlers.foremanEnable,undefined,'foreman'),
  foremanDisable:gated(foreman?.handlers.foremanDisable,undefined,'foreman'),
  foremanStatus:gated(foreman?.handlers.foremanStatus,undefined,'foreman'),
  getWaitingSummary:gated(foreman?.handlers.getWaitingSummary,async()=>({items:[],hash:'',fetchedAt:Date.now()}),'foreman'),
  scoutEnable:gated(scout?.handlers.scoutEnable,undefined,'scout'),
  scoutDisable:gated(scout?.handlers.scoutDisable,undefined,'scout'),
  scoutStatus:gated(scout?.handlers.scoutStatus,undefined,'scout'),
  scoutRunNow:gated(scout?.handlers.scoutRunNow,undefined,'scout'),
  showState:show?.handlers.showState??(async()=>({run:null,projectId:null,projectName:''})),
  showStart:show?.handlers.showStart??offHandler('show',health,getLanguage),
  showStop:show?.handlers.showStop??(async()=>null),
  async health(){return {features:health.list().map((f:FeatureState)=>f.error?f:{id:f.id,ok:f.ok}),indexedThreads:index.size};},
  async getTeam({projectId}){const {team,interns,waiting,coordinatorThreadId}=await read(projectId,await getLanguage());return {team,interns,waiting,coordinatorThreadId,fetchedAt:Date.now()};},
  // Who works in this thread, who gets the result, and the threads it delegated.
  async getThreadCard({threadId}){
   let t=await bb.sdk.threads.get({threadId});const seen=new Set<string>();
   while(t.parentThreadId&&!seen.has(t.id)){seen.add(t.id);try{t=await bb.sdk.threads.get({threadId:t.parentThreadId});}catch{break;}}
   const lang=await getLanguage();
   const {team,interns}=await read(t.projectId,lang);
   const people=[...team,...interns];
   const all=people.flatMap(r=>r.threads);
   const self=all.find(x=>x.id===threadId);if(!self)return null;
   const person=(id?:string)=>{if(!id)return null;if(id==='user')return {id,name:translator(lang)('you'),role:dataText(lang,'владелец решений')};const r=people.find(p=>p.id===id);return r?defined({id:r.id,name:r.name,role:r.role,intern:r.intern}):null;};
   const parentThread=self.parentThreadId?all.find(x=>x.id===self.parentThreadId):undefined;
   return {thread:self,status:threadStatus(self),who:person(self.roleId)!,handoff:person(self.handoffTo),
    parent:self.parentThreadId?{id:self.parentThreadId,title:parentThread?.title??null,who:person(parentThread?.roleId)}:null,
    children:all.filter(x=>x.parentThreadId===threadId).map(x=>({thread:x,status:threadStatus(x),who:person(x.roleId)!})),
    projectId:t.projectId};
  },
  async getChains(){return localizeChains(chains,await getLanguage());},
  getRoster:async()=>cards(await getLanguage()),
  getSkillCatalog:({projectId})=>skillCatalog(projectId),
  getLanguage,
  async setLanguage(value){return withBoardLock(bb,'language',async()=>{
   await bb.storage.kv.set('language',value);
   bb.realtime.publish('language-changed',value);
   return value;
  });},
  getExperiments:experimental,
  async setExperiments(value){return withBoardLock(bb,'experiments',async()=>{
   await experimentsReady;await bb.storage.kv.set('experiments',value);experiments=value;bb.realtime.publish('board-changed',null);return value;
  });},
  async getRole({roleId}){const lang=await getLanguage();const card=roleForKey(await cards(lang),roleId);
   if(!card)throw new Error(dataText(lang,'Неизвестная роль'));
   const base=baseRoles.find(r=>r.id===card.id)??customRole(card.id);
   return {card,defaults:localizeRole(base,lang)};},
  async updateRole({roleId,patch}){
   return withBoardLock(bb,CUSTOM_ROLES,async()=>{
    const [lang,{entries,custom}]=await Promise.all([getLanguage(),roleSettings()]);
    const tr=translator(lang);
    const all=localizedCards(entries,lang);
    const selected=roleId===null?null:roleForKey(all,roleId);
    const entry=entries.find(({base})=>base.id===selected?.id);
    if(roleId!==null&&!entry)throw new Error(dataText(lang,'Неизвестная роль'));
    const base=entry?.base??customRole(`custom-${crypto.randomUUID()}`);
    if(base.id==='rams'&&patch.enabled===false)throw new Error(dataText(lang,'Критика нельзя отключить'));
    if(!base.custom&&(patch.role!==undefined||patch.stage!==undefined||patch.avatar!==undefined||patch.callsUser!==undefined))
     throw new Error(tr('agent_custom_fields'));
    const next={...entry?.patch,...patch};
    const card=localizeRole(base,lang,next);
    if(!entry||patch.name!==undefined||patch.role!==undefined||patch.enabled===true){
     const checkName=!entry||patch.name!==undefined||patch.enabled===true;
     const otherLanguage=lang==='en'?'ru':'en';
     const issue=roleInputError(card,checkName?all:[])??(checkName
      ?roleInputError(localizeRole(base,otherLanguage,next),localizedCards(entries,otherLanguage)):null);
     if(issue)throw new Error(tr(issue));
    }
    if(base.custom)await bb.storage.kv.set(CUSTOM_ROLES,{...custom,[base.id]:next});
    else await bb.storage.kv.set('override:'+base.id,next);
    bb.realtime.publish('roles-changed',{roleId:base.id});
    return card;
   });
  },
  async resetRole({roleId}){
   return withBoardLock(bb,CUSTOM_ROLES,async()=>{
    const [lang,{entries}]=await Promise.all([getLanguage(),roleSettings()]);
    const selected=roleForKey(localizedCards(entries,lang),roleId);
    const base=baseRoles.find(r=>r.id===selected?.id);
    if(!base)throw new Error(dataText(lang,'Неизвестная роль'));
    for(const locale of LANGUAGES){
     const card=localizeRole(base,locale);
     const issue=card.enabled===false?null:roleInputError(card,localizedCards(entries,locale));
     if(issue)throw new Error(translator(lang)(issue));
    }
    await bb.storage.kv.delete('override:'+base.id);
    bb.realtime.publish('roles-changed',{roleId:base.id});
    return localizeRole(base,lang);
   });
  },
  async deleteRole({roleId}){
   return withBoardLock(bb,CUSTOM_ROLES,async()=>{
    const custom=await bb.storage.kv.get<Record<string,RolePatch>>(CUSTOM_ROLES)??{};
    if(!Object.hasOwn(custom,roleId))throw new Error(translator(await getLanguage())('agent_delete_custom_only'));
    const next={...custom};
    delete next[roleId];
    await bb.storage.kv.set(CUSTOM_ROLES,next);
    bb.realtime.publish('roles-changed',{roleId});
    return null;
   });
  },
 }));
 health.run('roster-tools',bb,SERVER_NEEDS['roster-tools'],()=>{
 bb.agents.registerTool({name:'team_roster',description:'Read one role card or the full roster, including configured provider, model, effort, tools, and skills.',parameters:z.object({role:z.string().optional()}).strict(),
  async execute({role},ctx){
   const roles=(await officeRoles()).filter(r=>r.enabled!==false);
   const resolve=async(r:Role)=>({...r,execution:await roleExecution(bb,ctx.projectId,r.brains,r.providerAvailable)});
   if(!role)return JSON.stringify(await Promise.all(roles.map(resolve)));
   const selected=roleForKey(roles,role);
   if(!selected)throw new Error(await errorText('Роль не найдена или выключена'));
   return JSON.stringify(await resolve(selected));
  }
 });
 bb.agents.registerTool({name:'team_mark',description:'Bind an existing thread to a role in plugin storage.',parameters:z.object({threadId:z.string().min(1),role:z.string().min(1)}).strict(),
  async execute({threadId,role},ctx){
   const base=await configuredRole(role);if(!base||base.enabled===false)throw new Error(await errorText('Роль не найдена или выключена'));
   const target=await bb.sdk.threads.get({threadId});
   if(!ctx.projectId||target.projectId!==ctx.projectId)throw new Error(translator(await getLanguage())('mark_project_required'));
   await bb.storage.kv.set('role:'+threadId,base.id);
   bb.realtime.publish('roles-changed',{threadId});
   return JSON.stringify({threadId,role:base.id});
  }
 });
 bb.agents.configure(ctx=>{
  const d=experiments&&dispatch?dispatch.selection(ctx):{tools:[],instructions:null};
  return {tools:['team_roster','team_mark',...(health.ok('route')?ROUTE_TOOLS:[]),...(health.ok('ask')?ASK_TOOLS:[]),...d.tools],skills:['cyber-office','design-gate','team-setup'],...(d.instructions?{instructions:d.instructions}:{})};
 });
 });
}
