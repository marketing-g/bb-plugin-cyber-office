import {DEFAULT_LANGUAGE, translator, type MessageKey} from './i18n.ts';
// Настоящий прогон для показа: агенты BB по цепочке делают короткую задачу выдуманного клиента.
// Здесь сценарий, промпты и состояние прогона. Чистые функции, без SDK: запуском занимается show-server.ts.
import type {RoleSummary,TeamStatus,Thread} from './model';
import type {FlowNode} from './flow';

/** Отдельный проект BB для показа: выдуманные данные. */
export const SHOW_PROJECT_NAME='Demo: Breeze Coffee';
export const SHOW_TASK="weekend_promotion_for_breeze_coffee_in";
export const SHOW_TITLE_PREFIX="demo_2";
/** Потолок расходов на один прогон в долларах. */
export const SHOW_BUDGET_USD=2;
/** Дешёвые мозги на всех: показываем, как работает связка, а не качество результата. */
export const SHOW_BRAINS={providerId:'claude-code',model:'claude-haiku-5-5'} as const;
export const SHOW_STEP_TIMEOUT_MS=5*60_000;
export const SHOW_TOTAL_TIMEOUT_MS=20*60_000;

export interface ShowStepDef {
 id:string;roleId:string;stage:FlowNode;title:MessageKey;
 /** Шаги, результат которых нужен до старта. */
 after:string[];
 /** Кому сдаёт: id роли или user. */
 to:string;
 /** Файл результата внутри папки прогона. */
 file:string;
 task:string;
}
export const SHOW_STEPS:ShowStepDef[]=[
 {id:'plan',roleId:'stas',stage:'stas',title:"assign_work_to_the_team",after:[],to:'sherlock',file:'0-plan.md',
  task:"Assign sales analysis, research, offer, copy, poster, quality review, and advertising planning. Give one acceptance criterion per deliverable."},
 {id:'data',roleId:'sherlock',stage:'intake',title:"four_weeks_of_sales_data",after:['plan'],to:'stas',file:'1-sales.md',
  task:"Calculate average weekday and weekend revenue, average order value, and the weakest weekend daypart. Give three findings with numbers."},
 {id:'voice',roleId:'sherlock',stage:'intake',title:"guest_reviews_and_nearby_cafes",after:['plan'],to:'stas',file:'1-feedback.md',
  task:"Summarize what guests like, what they complain about, and where the weekend offer can stand out."},
 {id:'offer',roleId:'stas',stage:'strategy',title:"weekend_offer",after:['data','voice'],to:'nora',file:'2-offer.md',
  task:"Propose a weekend offer with a discount of at most 20%. Specify audience, channel, expected extra orders, a 48-hour success threshold, and a fallback plan in at most 12 lines."},
 {id:'texts',roleId:'nora',stage:'make',title:"promotion_copy",after:['offer'],to:'rams',file:'3-nora-teksty.md',
  task:"Write a social caption in English (up to 60 words), a customer message (up to 30 words), and an entrance sign (up to 8 words)."},
 {id:'poster',roleId:'pixel',stage:'make',title:"poster",after:['offer'],to:'rams',file:'3-pixel-poster.svg',
  task:"Create a 1080 by 1080 SVG poster with shapes and text only. Include the offer, price or discount, dates, and “Breeze Coffee”. Use warm coastal colors and large type."},
 {id:'review',roleId:'rams',stage:'review',title:"review_copy_and_poster",after:['texts','poster'],to:'bolt',file:'4-rams-priyomka.md',
  task:"Review the copy and poster against the offer. Check clarity, numbers, dates, and the 20% discount cap. Give PASS or REWORK with up to three findings."},
 {id:'launch',roleId:'bolt',stage:'launch',title:"advertising_plan_for_thb",after:['review'],to:'stas',file:'5-launch.md',
  task:"Draft a weekend advertising plan for THB 3,000. Include channel, audience radius and interests, schedule, 48-hour metric, and stop threshold. Include any open review findings."},
 {id:'final',roleId:'stas',stage:'stas',title:"result_for_you",after:['launch'],to:'user',file:'6-itog.md',
  task:"Summarize the deliverables, offer and success threshold in up to ten lines. Ask one question about approving publication and budget. Keep the material in draft by default."},
];
const NAMES:Record<string,MessageKey>={stas:"stas",sherlock:"sherlock",nora:"nora",pixel:"pixel",rams:"rams",bolt:"bolt",user:"you"};
const DATIVE:Record<string,MessageKey>={stas:"stas_2",sherlock:"sherlock_2",nora:"nora_and_pixel",pixel:"pixel_2",rams:"rams_2",bolt:"bolt_2",user:"you_3"};
export const nameOf=(id:string,lang=DEFAULT_LANGUAGE)=>NAMES[id]?translator(lang)(NAMES[id]):id;
const toWhom=(id:string,lang=DEFAULT_LANGUAGE)=>DATIVE[id]?translator(lang)(DATIVE[id]):id;

export type ShowStepStatus='todo'|'working'|'waiting'|'done'|'error'|'stopped';
export interface ShowStepState {status:ShowStepStatus;threadId?:string;startedAt?:number;endedAt?:number;text?:string;costUsd?:number;error?:string}
export type ShowRunState='running'|'done'|'stopped'|'error'|'budget';
export interface ShowLogLine {at:number;text:string;from?:string;to?:string}
export interface ShowRun {
 id:string;projectId:string;dir:string;startedAt:number;endedAt?:number;
 state:ShowRunState;why?:string;budgetUsd:number;costUsd:number;costKnown:boolean;
 steps:Record<string,ShowStepState>;log:ShowLogLine[];poster?:string|null;
}

export function newRun(id:string,projectId:string,at:number,lang=DEFAULT_LANGUAGE):ShowRun{
 const tr=translator(lang);
 return {id,projectId,dir:`results/${id}`,startedAt:at,state:'running',budgetUsd:SHOW_BUDGET_USD,costUsd:0,costKnown:false,
  steps:Object.fromEntries(SHOW_STEPS.map(s=>[s.id,{status:'todo'} satisfies ShowStepState])),
  log:[{at,text:tr("you_ask_stas_to_plan_a_2", tr(SHOW_TASK)),from:'user',to:'stas'}]};
}
export const stepDef=(id:string)=>SHOW_STEPS.find(s=>s.id===id);
/** Шаги, которые можно запускать: все входы сданы, сам ещё не начат. */
export function readySteps(run:ShowRun):ShowStepDef[]{
 if(run.state!=='running')return [];
 return SHOW_STEPS.filter(s=>run.steps[s.id]?.status==='todo'&&s.after.every(a=>run.steps[a]?.status==='done'));
}
export const runFinished=(run:ShowRun)=>SHOW_STEPS.every(s=>run.steps[s.id]?.status==='done');

/** Заголовок треда: [Имя] Показ: задача. Метка «Показ:» отделяет прогон от рабочих тредов. */
export const showThreadTitle=(s:ShowStepDef,lang=DEFAULT_LANGUAGE,name=nameOf(s.roleId,lang))=>`[${name}] ${translator(lang)(SHOW_TITLE_PREFIX)} ${translator(lang)(s.title)}`;
export const isShowTitle=(t?:string|null)=>/^(\[[^\]]+\]\s*)?(?:Показ|Demo):/i.test((t??'').trim());

const clip=(t:string|undefined,n:number)=>{const s=(t??'').trim();return s.length>n?s.slice(0,n).trimEnd()+'…':s;};
/** Промпт шага: роль, правила показа, задача, входы от коллег, куда сдать. */
export function showPrompt(s:ShowStepDef,run:ShowRun,role:{name:string;role:string}):string{
 const inputs=s.id==='final'
  ?SHOW_STEPS.filter(x=>x.id!=='final').map(x=>`${nameOf(x.roleId)} (${translator('en')(x.title)}), file ${run.dir}/${x.file}:\n${clip(run.steps[x.id]?.text,500)}`)
  :[...(s.id!=='plan'&&!s.after.includes('plan')?['plan']:[]),...s.after].map(a=>{const d=stepDef(a)!;return `${nameOf(d.roleId)} (${translator('en')(d.title)}), file ${run.dir}/${d.file}:\n${clip(run.steps[a]?.text,a==='plan'?900:1200)}`;});
 const next=s.to==='user'?'User':nameOf(s.to);
 return [
  "Reply in the user's language",
  `You are ${role.name} (${role.role}) in a fictional Breeze Coffee demo in a coastal town.`,
  'Fictional sales, weeks 1 to 4 (THB): weekday revenue 29200, 30600, 29800, 31400 across five days per week. Weekend revenue 13200, 12800, 13600, 12400 across two days per week. Orders across all weeks: 1230. Average orders by daypart: 63 on weekend mornings versus 43 on weekday mornings, 49 on weekend afternoons, and 13 on weekend evenings.',
  'Fictional feedback: guests praise iced coffee and the shaded patio. They mention slow weekend morning service. Guests ask for a combo. Nearby cafes offer a brunch bundle and two coffees for the price of one in the afternoon. The promotion is for the coming weekend.',
  'Work only in the demo project. Use local file tools. Keep materials in draft. Avoid publishing or contacting anyone.',
  'Do not run shell commands, scripts, or validators, and do not request any permission. Write the file once and reply. Nobody is watching this thread to approve a prompt.',
  '',`Task: ${s.task}`,
  inputs.length?'\nInputs from other roles:\n\n'+inputs.join('\n\n'):'',
  '',`Save the result to ${run.dir}/${s.file}.`,
  `Finish with a handoff of at most six lines. Start the first line with “${next}:”, followed by the result and key numbers.`,
 ].filter(x=>x!=='').join('\n');
}

/** Строка журнала, когда шаг сдан: кто кому и первая строка передачи. */
export function handoffLine(s:ShowStepDef,text:string|undefined,at:number,lang=DEFAULT_LANGUAGE):ShowLogLine{
 const tr=translator(lang);
 const lines=(text??'').split('\n').map(x=>x.replace(/^[#>*\-\s]+/,'').trim()).filter(x=>x&&!x.startsWith('```'));
 const first=lines.find(x=>/^(result|итог)\s*:/i.test(x))??lines.find(x=>!/^(status|статус)\s*:/i.test(x))??'';
 return {at,from:s.roleId,to:s.to,text:tr("hands_off_to_4", nameOf(s.roleId,lang), s.to==='user'?tr("you_4"):toWhom(s.to,lang), clip(first.replace(/^[^:]{1,30}:\s*/,''),160)||tr(s.title))};
}
export function startLine(steps:ShowStepDef[],at:number,lang=DEFAULT_LANGUAGE):ShowLogLine{
 const tr=translator(lang);
 const who=steps.map(s=>`${nameOf(s.roleId,lang)}: ${tr(s.title)}`).join('; ');
 return {at,from:'stas',to:steps[0]?.roleId,text:steps.length>1?tr("working_in_parallel", who):tr("working_4", who)};
}

/** Стоимость прогона: сумма по шагам. Неизвестная стоимость шага не равна нулю, это помечается. */
export function sumCost(run:ShowRun):{usd:number;known:boolean}{
 let usd=0,known=true;
 for(const s of SHOW_STEPS){const st=run.steps[s.id];if(!st||st.status==='todo')continue;if(st.costUsd==null)known=false;else usd+=st.costUsd;}
 return {usd,known};
}

/* ---------- офис во время прогона ---------- */
const STATUS:Record<ShowStepStatus,TeamStatus>={todo:'free',working:'working',waiting:'waiting',done:'delivered',error:'error',stopped:'free'};
/**
 * Cyber Office на офисе: у каждой роли шаг прогона, живой тред и кому сдаёт.
 * Сданный шаг виден «Сдал», пока следующий за ним не взялся за работу.
 */
export function showTeam(team:RoleSummary[],run:ShowRun,lang=DEFAULT_LANGUAGE):RoleSummary[]{
 const tr=translator(lang);
 return team.map(r=>{
  const mine=SHOW_STEPS.filter(s=>s.roleId===r.id&&run.steps[s.id]&&run.steps[s.id].status!=='todo');
  const s=mine.filter(x=>['working','waiting','error'].includes(run.steps[x.id].status)).at(-1)??mine.at(-1);if(!s)return {...r,status:'free',threads:[],current:null};
  const st=run.steps[s.id];
  let status=STATUS[st.status];
  if(st.status==='done'){const taken=SHOW_STEPS.some(n=>n.after.includes(s.id)&&run.steps[n.id]?.status!=='todo');if(taken||s.to==='user'&&run.state!=='running')status=s.to==='user'?'waiting':'free';}
  // Между раздачей и итогом Стас не отдыхает: он ведёт цепочку.
  const watching=r.id==='stas'&&s.id==='plan'&&run.state==='running'&&status==='free';
  if(watching)status='working';
  const at=st.endedAt??st.startedAt??run.startedAt;
  const t:Thread={id:st.threadId??'show-'+s.id,projectId:run.projectId,title:watching?`[${r.name}] ${tr(SHOW_TITLE_PREFIX)} ${tr("coordinating_the_run")}`:showThreadTitle(s,lang,r.name),provider:SHOW_BRAINS.providerId,status:st.status==='working'||watching?'active':st.status==='error'?'error':'idle',
   hasPendingInteraction:status==='waiting',lastReadAt:status==='delivered'?at-1:at,latestAttentionAt:at,createdAt:st.startedAt??at,roleId:r.id,handoffTo:watching?'user':s.to};
  return {...r,status,threads:[t],current:t};
 });
}
/** Горячая стрелка: в какой узел сейчас едет работа. */
export function showFlow(run:ShowRun):[FlowNode,FlowNode]|null{
 if(run.state!=='running')return null;
 const working=SHOW_STEPS.filter(s=>run.steps[s.id]?.status==='working'||run.steps[s.id]?.status==='waiting');
 const s=working[0];if(!s)return null;
 if(s.id==='plan')return null;
 if(s.id==='final')return ['launch','stas'];
 const from=stepDef(s.after[0])!.stage;
 return [from,s.stage];
}
export function showProgress(run:ShowRun){const done=SHOW_STEPS.filter(s=>run.steps[s.id]?.status==='done').length;return {done,total:SHOW_STEPS.length};}
