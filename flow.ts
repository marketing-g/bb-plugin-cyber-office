import {DEFAULT_LANGUAGE, translator, type MessageKey} from './i18n.ts';
// Офис как цепочка: Стас сверху, ниже этапы по порядку передачи работы.
// Здесь же подпись «отдыхает с задачей» и сценарий тест-прогона. Чистые функции, без SDK.
import type {RoleSummary,TeamStatus,Thread} from './model';

export const STAGES=[
 {id:'intake',title:"research_and_data",note:"facts_numbers_and_bottlenecks",roles:['ada','sherlock','radar']},
 {id:'strategy',title:"strategy",note:"channel_metric_and_threshold",roles:['mark']},
 {id:'make',title:"production_2",note:"copy_seo_design_video_and_web",roles:['nora','sema','pixel','kadr','bolt']},
 {id:'review',title:"review_2",note:"the_critic_checks_the_work_before",roles:['rams']},
 {id:'launch',title:"launch",note:"ads_go_live_with_your_approval",roles:['tara']},
] as const satisfies readonly {id:string;title:MessageKey;note:MessageKey;roles:readonly string[]}[];
export type StageId=typeof STAGES[number]['id'];
export const DEFAULT_STAGE:StageId='make';
/** Узел цепочки: Стас или этап. Стрелка идёт между соседними узлами. */
export type FlowNode='stas'|StageId;
export const FLOW_ORDER:FlowNode[]=['stas',...STAGES.map(s=>s.id)];

/** Строка доски Стаса, ровно то, что нужно для подписи. */
export interface QueueRow {roleId:string;status:string;task:string}

const clean=(t?:string|null)=>(t||'').replace(/^\[[^\]]+\]\s*/,'').replace(/^(?:Показ|Demo):\s*/i,'').trim();
/**
 * Что делает свободный агент: следующая задача из доски, иначе последняя сданная,
 * иначе от кого ждёт задачу. Для занятых пусто: у них и так видна задача.
 */
export function restNote(role:RoleSummary,queue:QueueRow[]=[],lang=DEFAULT_LANGUAGE):{label:string;text:string}|null{
 const tr=translator(lang);
 if(role.status!=='free')return null;
 const next=queue.find(r=>r.roleId===role.id&&r.status==='todo');
 if(next)return {label:tr("up_next"),text:clean(next.task)};
 const last=role.current?clean(role.current.title):'';
 if(last)return {label:tr("delivered_2"),text:last};
 const from=role.takesFrom[0];
 return {label:tr("ready_for_work"),text:/^(you|вы)$/i.test(from??'')?tr("from_you"):from?tr("task_comes_from")+from:tr("from_the_coordinator")};
}

/** Горячая стрелка: в следующем узле кто-то работает над тем, что ему передали. */
export function liveFlows(team:RoleSummary[]):Set<string>{
 const out=new Set<string>();
 STAGES.forEach((s,i)=>{
  if(stageTeam(s,team).some(r=>r.status==='working'||r.status==='waiting'))out.add(`${FLOW_ORDER[i]}>${s.id}`);
 });
 return out;
}

export function stageTeam<T extends {id:string;stage?:StageId}>(stage:typeof STAGES[number],team:readonly T[]):T[]{
 return [...stage.roles.flatMap(id=>team.filter(r=>r.id===id)),...team.filter(r=>r.stage===stage.id)];
}

/* ---------- тест-прогон ---------- */
type Mark=[TeamStatus,MessageKey?,string?];
export interface DemoStep {log:MessageKey;set:Record<string,Mark>;flow?:[FlowNode,FlowNode]|null}
/** Показательная задача по цепочке. Агенты не запускаются, тратится ноль. */
export const DEMO_TASK="weekend_promotion_for_breeze_coffee";
export const DEMO_STEPS:DemoStep[]=[
 {log:"you_ask_stas_to_plan_a",set:{stas:['working',"assign_the_weekend_promotion_tasks",'user']}},
 {log:"sherlock_checks_sales_reviews_and_nearby",flow:['stas','intake'],set:{sherlock:['working',"sales_and_reviews",'stas']}},
 {log:"sherlock_shares_the_data_and_stas",flow:['intake','strategy'],set:{sherlock:['delivered'],stas:['working',"offer_and_price_threshold",'user']}},
 {log:"stas_asks_whether_to_use_thb",set:{sherlock:['free'],stas:['waiting',"price_threshold_thb_or",'user']}},
 {log:"after_your_answer_stas_assigns_work",flow:['strategy','make'],set:{stas:['working',"tracks_the_workflow",'user'],nora:['working',"promotion_copy",'rams'],pixel:['working',"poster_draft",'rams']}},
 {log:"nora_and_pixel_pass_their_work",flow:['make','review'],set:{nora:['delivered'],pixel:['delivered'],rams:['working',"review_copy_and_design",'bolt']}},
 {log:"rams_approves_the_work_and_bolt",flow:['review','launch'],set:{nora:['free'],pixel:['free'],rams:['delivered'],bolt:['working',"prepare_launch_materials",'stas']}},
 {log:"bolt_hands_off_the_work_and",flow:['launch','stas'],set:{rams:['free'],bolt:['delivered'],stas:['working',"result_for_you",'user']}},
 {log:"stas_is_waiting_for_your_approval",set:{bolt:['free'],stas:['waiting',"review_and_approve_publication",'user']}},
];
export const DEMO_STEP_MS=2400;

/**
 * Cyber Office на шаге прогона: накопленные статусы, по одному выдуманному треду
 * на занятую роль. Свободный после работы помнит сданную задачу.
 */
export function demoTeam(team:RoleSummary[],step:number,lang=DEFAULT_LANGUAGE):RoleSummary[]{
 const state=new Map<string,{s:TeamStatus;title:string;to?:string}>();
 for(const st of DEMO_STEPS.slice(0,step+1))for(const [id,[s,title,to]] of Object.entries(st.set)){const prev=state.get(id);state.set(id,{s,title:title?translator(lang)(title):prev?.title??'',to:to??prev?.to});}
 const at=1_000_000+step;
 return team.map(r=>{
  const x=state.get(r.id);
  if(!x)return {...r,status:'free',threads:[],current:null};
  const t:Thread={id:'demo-'+r.id,projectId:'demo',title:x.title,provider:r.brains.providerId??'claude-code',status:x.s==='working'?'active':'idle',
   hasPendingInteraction:x.s==='waiting',lastReadAt:x.s==='delivered'?at-1:at,latestAttentionAt:at,createdAt:at,roleId:r.id,handoffTo:x.to};
  return {...r,status:x.s,threads:[t],current:t};
 });
}
