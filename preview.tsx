import {OfficeLanguage,useText} from './i18n-ui';
import {languageOf,localizeChains,translator,type Language,type MessageKey} from './i18n.ts';
import {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import roster from './team.json';import chains from './chains.json';
import {TeamView,type TeamViewData,type Theme,type Tab} from './ui';
import {setLookTransform,spriteRuns} from './sprites';
import {LOOK_SETS,isLookSet,lookTransform,type LookSet} from './kiborgi';
const setLookSet=(s:LookSet)=>setLookTransform(lookTransform(s));
import {applyPatch,customRole,localizeRole,roleInputError,summarize,type Role,type RolePatch,type TeamStatus,type Thread} from './model';
import {STAGES} from './flow';
import './app.css';
import {PassList} from './pass';
import {SHOW_STEPS,handoffLine,newRun,startLine,type ShowRun} from './show';
import {SKILL_ORIGINS,type CatalogSkill,type SkillCategory} from './skill-categories';
// Выдуманный настоящий прогон: ?show=mid (идёт), ?show=done (итог с постером), ?show=elsewhere (прогон в другом проекте).
const SHOW_TEXT:Record<string,MessageKey>={
 plan:'demo_plan',data:'demo_data',voice:'demo_voice',offer:'demo_offer',
 texts:'demo_texts',poster:'demo_poster',review:'demo_review',launch:'demo_launch',final:'demo_final',
};
const poster=(tr:ReturnType<typeof translator>)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#f6c28b"/><rect y="700" width="1080" height="380" fill="#2a9d8f"/><circle cx="820" cy="300" r="140" fill="#e76f51"/><text x="80" y="260" font-size="96" font-family="sans-serif" font-weight="800" fill="#264653">${tr("demo_poster_title")}</text><text x="80" y="420" font-size="150" font-family="sans-serif" font-weight="900" fill="#264653">199 ฿</text><text x="80" y="520" font-size="48" font-family="sans-serif" fill="#264653">${tr("demo_poster_offer")}</text><text x="80" y="960" font-size="44" font-family="sans-serif" fill="#fff">Breeze Coffee</text></svg>`;
function fakeRun(mode:string,lang:Language):ShowRun{
 const tr=translator(lang);
 const t0=Date.now()-4*60_000;const r=newRun('demo-run','demo',t0,lang);let at=t0;
 const upto=mode==='done'?SHOW_STEPS.length:4;
 SHOW_STEPS.forEach((s,i)=>{if(i>=upto)return;at+=25_000;r.steps[s.id]={status:'done',threadId:'thr_show'+s.id,startedAt:at-20_000,endedAt:at,text:tr(SHOW_TEXT[s.id]),costUsd:0.03};r.log.push(handoffLine(s,tr(SHOW_TEXT[s.id]),at,lang));});
 if(mode!=='done'){r.log.push(startLine([SHOW_STEPS[4],SHOW_STEPS[5]],at,lang));for(const s of [SHOW_STEPS[4],SHOW_STEPS[5]])r.steps[s.id]={status:'working',threadId:'thr_show'+s.id,startedAt:at};r.costUsd=0.14;r.costKnown=false;}
 else {r.state='done';r.endedAt=at;r.costUsd=0.27;r.costKnown=true;r.poster=poster(tr);r.log.push({at,text:tr("stas_is_waiting_for_your_approval")});}
 return r;
}
// Invented demo data: one role per status so every state is visible.
const plan:Record<string,{s:TeamStatus;title:MessageKey|''}>={
 stas:{s:'working',title:"coordinate_project_tasks"},ada:{s:'working',title:"ada_review_leads_after_hours"},sherlock:{s:'delivered',title:"sherlock_find_campaign_references"},
 mark:{s:'waiting',title:"mark_cost_per_lead_target_thb"},nora:{s:'working',title:"nora_write_promotion_copy"},sema:{s:'working',title:"sema_seo_audit"},
 pixel:{s:'waiting',title:"pixel_prepare_two_draft_designs"},kadr:{s:'working',title:"kadr_edit_a_second_video"},bolt:{s:'error',title:"bolt_site_build_failed"},
 rams:{s:'free',title:''},tara:{s:'delivered',title:"tara_campaign_import_file_is_ready"},
};
const now=1794268800000;
function thread(id:string,title:string,s:TeamStatus,parent:string|null=null,projectId='demo'):Thread{return {id,projectId,parentThreadId:parent,createdAt:now,title,provider:'claude-code',status:s==='working'?'active':s==='error'?'error':'idle',hasPendingInteraction:s==='waiting',lastReadAt:s==='delivered'?now-5000:now,latestAttentionAt:now-1000,execution:null};}
function build(roles:Role[],lang:Language):TeamViewData{
 const tr=translator(lang);
 const threads:Thread[]=[];
 for(const [id,p] of Object.entries(plan))if(p.s!=='free'&&roles.some(r=>r.id===id))threads.push(thread('thr_demo'+id,p.title?tr(p.title):'',p.s,id==='stas'?null:'thr_demostas',id==='sema'?'site':'demo'));
 threads.push(thread('thr_demoada2',tr("ada_review_campaign_history"),'free','thr_demostas'));
 threads.push(thread('thr_demointern1',tr("prepare_a_presentation_for_partners"),'working','thr_demostas'));
 threads.push(thread('thr_demointern2',tr("check_robots_txt_and_redirects"),'delivered','thr_demosema','site'));
 threads.push(thread('thr_demoother',tr("unrelated_thread_in_another_project"),'working',null,'site'));
 const r=summarize(roles,threads,'demo',{},{demo:'thr_demostas'},lang);
 return {team:r.team,interns:r.interns,waiting:r.waiting,fetchedAt:now,coordinatorThreadId:r.coordinatorThreadId};
}

// Sheet of every role: ?sheet=1 (all sets) or ?sheet=1&look=a (current set and A). Full sprite at work,
// head crops at 30 px at work and free.
const SHEET_IDS=['stas','ada','sherlock','mark','radar','nora','sema','pixel','rams','kadr','bolt','tara','intern0','intern1','intern2','intern3'];
// Drawn eagerly (a plain call, not a component) so each set is read while it is active.
function px(id:string,status:'working'|'free',size:number,head=false){const rows=head?13:20;
 return <svg className="km-px" width={size} height={size*rows/20} viewBox={`0 0 20 ${rows}`} shapeRendering="crispEdges" aria-hidden="true">{spriteRuns(id,status,rows).map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill}/>)}</svg>;}
function Sheet({theme,look,only}:{theme:Theme;look:LookSet;only:string|null}){
 const tr=useText();
 const fg=theme==='dark'?'#eef1f8':'#1f2333',muted=theme==='dark'?'#a3acc2':'#5b6275',line=theme==='dark'?'#2c3350':'#d9d2c4';
 const sets=LOOK_SETS.filter(l=>!isLookSet(only)||only==='base'||l.id===only||l.id==='base');
 const out=<div className="km-sheet" style={{padding:'20px 24px',color:fg,font:'14px system-ui'}}>
  {sets.map(l=>{setLookSet(l.id);return <section key={l.id} style={{borderTop:'2px solid '+line,padding:'14px 0 18px'}}>
   <h2 style={{margin:'0 0 2px',fontSize:20}}>{tr(l.name)}</h2><p style={{margin:'0 0 12px',color:muted}}>{tr(l.note)}</p>
   <div style={{display:'flex',flexWrap:'wrap',gap:'12px 16px',alignItems:'flex-end'}}>
    {SHEET_IDS.map(id=><figure key={id} style={{margin:0,display:'grid',justifyItems:'center',gap:4}}>
     <div style={{display:'flex',gap:6,alignItems:'flex-end'}}>{px(id,'working',64)}</div>
     <div style={{display:'flex',gap:6,alignItems:'center'}}>{px(id,'working',30,true)}{px(id,'free',30,true)}</div>
     <figcaption style={{fontSize:11,color:muted}}>{id.startsWith('intern')?tr("intern_2"):id}</figcaption>
    </figure>)}
   </div>
  </section>;})}
 </div>;
 setLookSet(look);return out;
}
const VIEWS = {office:'team',scheme:'schema',chains:'chains',settings:'settings',handoffs:'passes'} as const satisfies Record<string,Tab>;
const productionIds:readonly string[]=STAGES.find(s=>s.id==='make')!.roles;
const previewDefaults=roster.roles as Role[];

function previewRoster(count:string|null,lang:Language):Role[]{
 const n=Number(count);
 if(count===null||!Number.isInteger(n))return previewDefaults;
 const seats=Math.max(1,Math.min(14,n));
 const keep=productionIds.slice(0,seats);
 const tr=translator(lang);
 const extras=Array.from({length:Math.max(0,seats-keep.length)},(_,i)=>({
  ...customRole(`preview-agent-${i+1}`),custom:false,name:tr('preview_agent_name',i+1),role:tr('preview_agent_position'),
  avatar:`intern${i%4}`,
 }));
 return [...previewDefaults.flatMap(r=>keep.includes(r.id)?[{...r,enabled:true}]:productionIds.includes(r.id)?[]:[r]),...extras];
}

export function Preview({search=''}:{search?:string}){
 const query=useMemo(()=>new URLSearchParams(search),[search]);
 const [language,setLanguage]=useState(()=>languageOf(query.get('lang')));
 return <OfficeLanguage.Provider value={language}><PreviewBody q={query} lang={language} onLanguage={setLanguage}/></OfficeLanguage.Provider>;
}

const sampleSkills = [
 ['source-notes','research','source_notes'], ['market-scan','research','market_scan'], ['fact-check','research','fact_check'],
 ['headline-lab','writing','headline_lab'], ['copy-polish','writing','copy_polish'], ['newsletter-draft','writing','newsletter'],
 ['visual-layout','design','layout'], ['contrast-review','design','contrast'], ['color-palette','design','colors'], ['responsive-mockup','design','mockup'],
 ['code-review','code','code_review'], ['unit-test-kit','code','unit_tests'], ['debug-trace','code','debug'],
 ['csv-cleanup','data','csv'], ['metrics-summary','data','metrics'], ['spreadsheet-audit','data','spreadsheet'],
 ['seo-check','marketing','seo'], ['campaign-plan','marketing','campaign'], ['product-positioning','marketing','positioning'],
 ['sales-pipeline','sales','pipeline'], ['discovery-call','sales','discovery'],
 ['meeting-minutes','documents','minutes'], ['slide-format','documents','slides'],
 ['workflow-handoff','automation','workflow'], ['recurring-reminders','automation','reminders'],
 ['acceptance-checklist','other','checklist'], ['asset-naming','other','naming'],
] as const satisfies readonly (readonly [string,SkillCategory,string])[];

function PreviewBody({q,lang,onLanguage}:{q:URLSearchParams;lang:Language;onLanguage:(lang:Language)=>void}){
 const tr=useText();
 const picker=q.get('picker');
 const initialPicker=picker==='skills'||picker==='tools'?picker:null;
 const skillCatalog=useMemo<CatalogSkill[]>(()=>sampleSkills.map(([name,category,copy],index)=>({
  name,category,description:translator(lang)(`preview_skill_${copy}`),origin:SKILL_ORIGINS[index%SKILL_ORIGINS.length],
 })),[lang]);
 const [theme,setTheme]=useState<Theme>(q.get('theme')==='light'?'light':'dark');const [opened,setOpened]=useState('');const [project,setProject]=useState('demo');const [ov,setOv]=useState<Record<string,RolePatch>>({});
 const [look,setLook]=useState<LookSet>(isLookSet(q.get('look'))?q.get('look') as LookSet:'base');
 setLookSet(look);
 useEffect(()=>{
  document.documentElement.lang=lang;
  document.documentElement.dataset.kmLook=look;
  document.documentElement.style.background=document.body.style.background=theme==='dark'?'#0e1120':'#f6f2ea';
 },[lang,look,theme]);
 const bases=useMemo(()=>previewRoster(q.get('agents'),lang),[q,lang]);
 const roles=useMemo(()=>[
  ...bases.map(r=>localizeRole(r,lang,look==='base'?ov[r.id]:{...ov[r.id],look:ov[r.id]?.look??look})),
  ...Object.keys(ov).filter(id=>id.startsWith('custom-')).map(id=>applyPatch(customRole(id),ov[id])),
 ],[bases,lang,look,ov]);
 const removePatch=(id:string)=>setOv(o=>{const n={...o};delete n[id];return n;});
 const saveRole=async(id:string|null,patch:RolePatch)=>{
  const role=id===null?customRole(`custom-${crypto.randomUUID()}`):roles.find(r=>r.id===id);
  if(!role)return;
  const normalized={...patch};
  if(patch.name!==undefined)normalized.name=patch.name.trim();
  if(patch.role!==undefined)normalized.role=patch.role.trim();
  if(patch.callsUser!==undefined)normalized.callsUser=patch.callsUser.trim();
  const issue=roleInputError(applyPatch(role,normalized),id===null||patch.name!==undefined||patch.enabled===true?roles:[]);
  if(issue)throw new Error(tr(issue));
  setOv(o=>({...o,[role.id]:{...o[role.id],...normalized}}));
 };
 const data=useMemo(()=>build(roles,lang),[roles,lang]);
 const blocks=useMemo(()=>localizeChains(chains,lang).blocks,[lang]);
 const view=q.get('view');
 const legacyTab=q.get('tab');
 const initialTab=view&&Object.hasOwn(VIEWS,view)?VIEWS[view as keyof typeof VIEWS]:legacyTab==='schema'||legacyTab==='chains'?legacyTab:'team';
 const showMode=q.get('show');
 const [mode,setMode]=useState(showMode);
 const showRun=useMemo(()=>mode?fakeRun(mode==='stopped'?'mid':mode,lang):null,[mode,lang]);
 const here=showMode!=='elsewhere';const show=showMode?{run:here&&showRun?(mode==='stopped'?{...showRun,state:'stopped' as const,why:tr("stopped_by_the_user"),endedAt:now}:showRun):null,here,running:showRun?.state==='running'&&mode!=='stopped',demoProjectId:'demo',demoProjectName:'Demo: Breeze Coffee',ready:true,onStart:async()=>setMode('mid'),onStop:async()=>setMode('stopped')}:undefined;
 const empty:TeamViewData={...data,team:data.team.map(r=>({...r,status:'free',threads:[],current:null})),interns:[],waiting:0};
 return <div>
  {!q.get('clean')&&<div style={{padding:'8px 24px',background:theme==='dark'?'#202b3b':'#dde3ed',color:theme==='dark'?'white':'#202938',font:'12px system-ui',display:'flex',gap:16,alignItems:'center'}}><b>{tr("preview_with_sample_data")}</b><label>{tr("theme")} <select value={theme} onChange={e=>setTheme(e.target.value as Theme)}><option value="dark">{tr("dark")}</option><option value="light">{tr("light")}</option></select></label><label>{tr("cyborgs")} <select value={look} onChange={e=>setLook(e.target.value as LookSet)}>{LOOK_SETS.map(l=><option key={l.id} value={l.id}>{tr(l.name)}</option>)}</select></label><span role="status">{opened?tr("opened")+opened:''}</span></div>}
  {q.get('sheet')?<Sheet theme={theme} look={look} only={q.get('look')}/>:<TeamView PassesPanel={({names})=><PassList names={names} onThread={setOpened} passes={[
   {boardId:'demo',at:now,from:'stas',to:'nora',task:tr('promotion_copy'),threadId:'thr_demonora',kind:'dispatch'},
   {boardId:'demo',at:now+60_000,from:'nora',to:'rams',task:tr('promotion_copy'),threadId:'thr_demonora',kind:'review'},
   {boardId:'demo',at:now+120_000,from:'rams',to:'stas',task:tr('promotion_copy'),threadId:'thr_demonora',kind:'done'},
  ]}/>} roster={roles} onLanguage={async language=>onLanguage(language)} theme={theme} data={project==='empty'?empty:data} blocks={blocks} projects={[{id:'demo',name:tr("demo_project")},{id:'empty',name:tr("empty_project")}]} projectId={project} onProject={setProject} onThread={setOpened}
   initialTab={initialTab} initialRole={q.get('card')??(initialPicker?'pixel':q.get('role'))} initialRoleEdit={q.has('card')}
   initialPicker={initialPicker} initialSkills={skillCatalog} initialAdd={q.get('add')==='1'&&!initialPicker} initialChainPath={q.get('path')?.split(',')}
   show={show} onSendTask={async t=>{setOpened(tr("to_stas")+t);return tr("sent_to_stas");}}
   onSaveRole={saveRole} onResetRole={async id=>removePatch(id)} onDeleteRole={async id=>removePatch(id)}/>}
 </div>;
}
if(typeof document!=='undefined')createRoot(document.getElementById('root')!).render(<Preview search={location.search}/>);
