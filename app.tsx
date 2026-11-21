import {useLanguage,useText} from './i18n-ui';
import {text as tr,translator,type Language} from './i18n.ts';
import {useCallback,useEffect,useRef,useState} from 'react';
import {definePluginApp,experimental_InfoSection as InfoSection,experimental_THREAD_INFO_SECTION_GROUPS,experimental_useCodeTheme,experimental_useThreadContextKind,useBbNavigate,useRpc,useSdk,useRealtime,type PluginHomepageSectionProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {TeamView,Waiting,type BoardView,type TeamViewData,type Step,type Theme,type ShowControl} from './ui';
import type {ShowRun} from './show';
import {ThreadTeam,TeamThreadDirective,TeamSegmentSummary,TeamSegmentDetails} from './thread';
import type {Role,RolePatch} from './model';
import './app.css';
import {registerItog} from './itog-app';
import {ITOG_ASK_PROMPT} from './itog-rules';
import {registerRoute} from './route-form';
import {registerAsk} from './ask-form';
import {setLookTransform} from './sprites';
import {lookTransform} from './kiborgi';
import {feature,guard,useStoredLanguage} from './compat-app';
import {VoiceField} from './voice-field';
import {readWaitingSummary,registerForemanUI} from './foreman-ui';
import {Passes,TeamPassDirective} from './pass';
const PassesPanel=guard('pass',Passes);

// Киборги: набор Б «по роли». Ошибка набора возвращает обычные спрайты.
const LOOK='b' as const;
try{
 const t=lookTransform(LOOK);
 setLookTransform(t?(key,base)=>{try{return t(key,base);}catch{return base;}}:null);
}catch(e){console.warn(tr("cyber_office_cyborgs_disabled"),e);setLookTransform(null);}

function useTheme():Theme{
 try{return experimental_useCodeTheme().mode==='light'?'light':'dark';}catch{return 'dark';}
}
function useBoard(projectId:string){
 const rpc=useRpc<typeof rpcContract>();
 const [data,setData]=useState<TeamViewData|null>(null);const [boards,setBoards]=useState<BoardView[]>([]);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(false);
 const requestRefresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let alive=true,busy=false,queued=false;
  const refresh=async()=>{
   if(!projectId||!alive)return;if(busy){queued=true;return;}busy=true;setLoading(true);
   try{
    // Доска Стаса необязательна: если её кусок выключен, офис живёт без неё.
    const [team,b,waitingSummary]=await Promise.all([rpc.call('getTeam',{projectId}),rpc.call('getBoards',{projectId}).catch(()=>({boards:[]})),readWaitingSummary(rpc,projectId)]);
    if(alive){setData({...team,waitingSummary});setBoards(b.boards as BoardView[]);setError(null);}}
   catch(e){if(alive){setError(String(e));}}
   finally{busy=false;if(alive){setLoading(false);if(queued){queued=false;void refresh();}}}
  };
  requestRefresh.current=()=>void refresh();setData(null);setBoards([]);setError(null);void refresh();
  const timer=setInterval(()=>void refresh(),30000);
  return()=>{alive=false;requestRefresh.current=()=>{};clearInterval(timer);};
 },[rpc,projectId]);
 useRealtime('threads-changed',()=>requestRefresh.current());
 useRealtime('roles-changed',()=>requestRefresh.current());
 useRealtime('board-changed',()=>requestRefresh.current());
 useRealtime('language-changed',()=>requestRefresh.current());
 return {data,boards,error,loading,refresh:()=>requestRefresh.current()};
}
/**
 * Настоящий прогон: состояние с сервера, живые обновления, кнопки старт и стоп.
 * Прогон живёт только в своём проекте «Демо», поэтому на доске клиента его нет:
 * там остаётся лишь строка о том, что прогон идёт, чтобы он не крутился незамеченным.
 */
function useShow(projectId:string):ShowControl|undefined{
 const rpc=useRpc<typeof rpcContract>();
 const [run,setRun]=useState<ShowRun|null>(null);const [demoId,setDemoId]=useState<string|null>(null);const [demoName,setDemoName]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [off,setOff]=useState(false);
 const load=useCallback(()=>rpc.call('showState',null).then(s=>{setRun(s.run as ShowRun|null);setDemoId(s.projectId);setDemoName(s.projectName);setOff(false);}).catch(()=>setOff(true)),[rpc]);
 useEffect(()=>{void load();},[load]);
 // Пока прогон идёт, обновляем чаще: realtime может не дойти до телефона.
 useEffect(()=>{if(run?.state!=='running')return;const t=setInterval(()=>void load(),4000);return()=>clearInterval(t);},[run?.state,load]);
 useRealtime('show-changed',()=>void load());
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError(null);try{await fn();await load();}catch(e){setError(String((e as Error)?.message??e));}finally{setBusy(false);}};
 if(off)return undefined;
 const here=!!demoId&&demoId===projectId;
 return {run:here?run:null,running:run?.state==='running',here,demoProjectId:demoId,demoProjectName:demoName,ready:!!demoId,busy,error,
  onStart:()=>act(()=>rpc.call('showStart',null)),onStop:()=>act(()=>rpc.call('showStop',null))};
}
function Page(){
 const tr=useText();const language=useLanguage();
 const sdk=useSdk();const rpc=useRpc<typeof rpcContract>();const nav=useBbNavigate();const theme=useTheme();
 const [projects,setProjects]=useState<{id:string;name:string}[]>([]);const [projectId,setProjectId]=useState('');const [blocks,setBlocks]=useState<Step[]>([]);const [setupError,setSetupError]=useState<string|null>(null);
 useEffect(()=>{let alive=true;sdk.projects.list().then(p=>{if(!alive)return;setProjects(p);setProjectId(p[0]?.id||'');}).catch(e=>{if(alive)setSetupError(String(e));});return()=>{alive=false;};},[sdk]);
 useEffect(()=>{let alive=true;rpc.call('getChains',null).then(c=>{if(alive)setBlocks(c.blocks);}).catch(e=>{if(alive)setSetupError(String(e));});return()=>{alive=false;};},[rpc,language]);
 const board=useBoard(projectId);
 const [roles,setRoles]=useState<Role[]>([]);const [experiments,setExperiments]=useState(false);
 const loadRoles=useCallback(()=>rpc.call('getRoster',null).then(setRoles).catch(e=>setSetupError(String(e))),[rpc]);
 useEffect(()=>{void loadRoles();void rpc.call('getExperiments',null).then(setExperiments).catch(e=>setSetupError(String(e)));},[rpc,loadRoles,language]);
 useRealtime('roles-changed',()=>void loadRoles());
 const onLanguage=async(value:Language)=>{await rpc.call('setLanguage',value);};
 const onExperiments=async(value:boolean)=>{setExperiments(await rpc.call('setExperiments',value));board.refresh();};
 const experiment=async(action:()=>Promise<unknown>)=>{try{await action();board.refresh();setSetupError(null);}catch(e){setSetupError(String(e));}};
 const coordinator=board.data?.coordinatorThreadId;
 const experimentControls=<div>{coordinator&&<><button onClick={()=>void experiment(()=>rpc.call('dispatcherEnable',{threadId:coordinator,confirmCoordinator:coordinator}))}>{tr("enable_dispatch_and_shift_handoffs")}</button><button onClick={()=>void experiment(()=>rpc.call('dispatcherDisable',{threadId:coordinator}))}>{tr("disable_dispatch")}</button></>}{board.boards.map(b=><div key={b.id}><b>{b.title}</b><button onClick={()=>void experiment(()=>rpc.call('foremanEnable',{boardId:b.id}))}>{tr("enable_foreman")}</button><button onClick={()=>void experiment(()=>rpc.call('foremanDisable',{boardId:b.id}))}>{tr("disable_foreman")}</button><button onClick={()=>void experiment(()=>rpc.call('scoutEnable',{boardId:b.id}))}>{tr("enable_scout")}</button><button onClick={()=>void experiment(()=>rpc.call('scoutDisable',{boardId:b.id}))}>{tr("disable_scout")}</button></div>)}</div>;
 const show=useShow(projectId);
 const onSendTask=useCallback(async(text:string)=>{
  const threadId=board.data?.coordinatorThreadId;
  if(!threadId){
   const name=board.data?.team.find(r=>r.id==='stas')?.name??tr("stas");
   const initialPrompt=`Reply in the user's language\n\nYou are ${name}, the Cyber Office coordinator. Use the cyber-office skill.\n\nUser task: ${text}`;
   nav.toCompose({projectId,initialPrompt,focusPrompt:true});
   return tr("a_new_task_thread_is_ready");
  }
  await sdk.threads.send({threadId,input:[{type:'text',text}],mode:'queue-if-active'} as Parameters<typeof sdk.threads.send>[0]);
  nav.toThread(threadId);
  return tr("task_sent_to_coordinator");
 },[board.data,nav,projectId,sdk,tr]);
 const onSaveRole=useCallback(async(roleId:string|null,patch:RolePatch)=>{await rpc.call('updateRole',{roleId,patch});await loadRoles();board.refresh();},[rpc,board,loadRoles]);
 const loadSkills=useCallback(()=>rpc.call('getSkillCatalog',projectId?{projectId}:{}),[rpc,projectId]);
 const onDeleteRole=useCallback(async(roleId:string)=>{await rpc.call('deleteRole',{roleId});await loadRoles();board.refresh();},[rpc,board,loadRoles]);
 const onResetRole=useCallback(async(roleId:string)=>{await rpc.call('resetRole',{roleId});await loadRoles();board.refresh();},[rpc,board,loadRoles]);
 // BB gives the panel a full-bleed body without scrolling: the page scrolls itself.
 return <div className="km-page" data-theme={theme} data-km-look={LOOK}><TeamView onLanguage={onLanguage} roster={roles.filter(r=>experiments||r.id!=="radar")} experiments={experiments} onExperiments={onExperiments} experimentControls={experimentControls} data={board.data} boards={board.boards} PassesPanel={PassesPanel} error={setupError||board.error} loading={board.loading} blocks={blocks} projects={projects} projectId={projectId} onProject={setProjectId} onThread={id=>nav.toThread(id)} onSendTask={onSendTask} TaskField={VoiceField} onSaveRole={onSaveRole} onResetRole={onResetRole} onDeleteRole={onDeleteRole} loadSkills={loadSkills} show={show} theme={theme}/></div>;
}
function Home({projectId}:PluginHomepageSectionProps){
 const tr=useText();const nav=useBbNavigate();const theme=useTheme();const {data,error}=useBoard(projectId??'');return <div className="km km-home" data-theme={theme}>{error?<p role="alert">{error}</p>:data?<Waiting data={data} onThread={id=>nav.toThread(id)}/>:<p>{projectId?tr("loading"):tr("choose_a_project")}</p>}</div>;}
/** Rail badge: how many threads wait for the user in the default project. */
function useWaitingBadge(){
 const tr=translator(useStoredLanguage());
 const sdk=useSdk();const rpc=useRpc<typeof rpcContract>();const [n,setN]=useState(0);const tick=useRef<()=>void>(()=>{});
 useEffect(()=>{let alive=true;const load=()=>{void sdk.projects.list().then(async projects=>{const p=projects[0];const count=p?(await rpc.call('getTeam',{projectId:p.id})).waiting:0;if(alive)setN(count);}).catch(()=>{});};tick.current=load;load();const t=setInterval(load,60000);return()=>{alive=false;clearInterval(t);tick.current=()=>{};};},[rpc,sdk]);
 useRealtime('threads-changed',()=>tick.current());
 return n>0?{count:n,tone:'warning' as const,label:tr("waiting_for_you_5", n)}:null;
}
function InfoTeam({threadId}:{threadId:string}){return <InfoSection label="Cyber Office"><ThreadTeam threadId={threadId}/></InfoSection>;}
export default definePluginApp(app=>{
 feature(app,'foreman',registerForemanUI);
 // Каждый кусок регистрируется отдельно: если обновление BB что-то убрало, отключится только он.
 feature(app,'office',a=>{
  a.slots.navPanel({id:'cyber-office',title:'Cyber Office',icon:'Users',path:'cyber-office',component:Page,experimental_useBadge:useWaitingBadge});
  a.slots.homepageSection({id:'waiting',title:tr("waiting_for_you"),component:Home});
 });
 // Thread view: who works here, who gets the result, and jumps to delegated threads.
 feature(app,'thread-block',a=>{
  a.slots.experimental_threadContextCardSection({id:'team',title:'Cyber Office',group:experimental_THREAD_INFO_SECTION_GROUPS.related,order:0,component:({threadId})=><ThreadTeam threadId={threadId}/>});
  a.slots.experimental_threadInfoSection({id:'team',group:experimental_THREAD_INFO_SECTION_GROUPS.related,order:0,component:InfoTeam});
  // Narrow panes show the context row instead of the card: put the same block there.
  a.slots.experimental_threadContextSegment({id:'team',title:'Cyber Office',group:'1_thread',order:50,summary:TeamSegmentSummary,details:TeamSegmentDetails,useVisible:()=>experimental_useThreadContextKind()==='banner'});
  a.slots.messageDirective({id:'team-thread',component:TeamThreadDirective});
 });
 // Блок ```itog в ответе агента рисуется карточкой.
 feature(app,'itog',registerItog);
 // Запасной ход: агент ответил полотном, кнопка вставляет просьбу дать итог. Отправляет вы сам.
 feature(app,'itog-ask',a=>a.slots.messageAction({id:'itog-ask',title:tr("request_a_result"),icon:'ListChecks',run:ctx=>{
  if(ctx.message.role!=='assistant'||!ctx.composer)return;
  ctx.composer.insert(ITOG_ASK_PROMPT,{at:'end',block:true});ctx.composer.focus?.();
 }}));
 // Разнос сообщения по агентам: форма подтверждения, кнопка на сообщении, мост RPC.
 feature(app,'route',registerRoute);
 feature(app,'pass',a=>a.slots.messageDirective({id:'team-pass',component:TeamPassDirective}));
 feature(app,'ask',registerAsk);
});
