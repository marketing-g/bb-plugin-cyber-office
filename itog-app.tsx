import {useLanguage,useText} from './i18n-ui';
// Слот карточки «Итог» в чате BB. app.tsx вызывает registerItog(app) внутри definePluginApp.
import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {definePluginApp,experimental_FileLink as FileLink,experimental_copyToClipboard,experimental_useCanOpenFileExternally,experimental_useCodeTheme,useBbNavigate,useComposers,useSdk} from '@get-bb/plugin-sdk/app';
import {canOpenItogFile,createSentLedger,itogAnswerKey,itogFileLink,judgeItog,parseItog,type ItogFileContext,type ItogFileTarget} from './itog';
import {ItogCard,type ItogTheme,type SendDelivery} from './itog-card';
import {VoiceField} from './voice-field';
import './itog.css';

type PluginApp=Parameters<Parameters<typeof definePluginApp>[0]>[0];
type FenceProps={code:string;language:string;status:'closed'|'streaming'|'unclosed';index:number;message:{id:string;threadId:string};Original:React.ComponentType};
type Sdk=ReturnType<typeof useSdk>;

// Что уже ушло из карточек: память сессии плюс localStorage, если BB его даёт.
function safeStorage(){try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
const sent=createSentLedger(safeStorage());
/** Ответы в пути: та же карточка, нарисованная дважды, не отправит ответ второй раз. */
const inflight=new Set<string>();

function useItogTheme():ItogTheme{try{return experimental_useCodeTheme().mode==='light'?'light':'dark';}catch{return 'dark';}}

/** Машина и рабочая папка треда: один запрос на тред за сессию. */
const contexts=new Map<string,Promise<ItogFileContext>>();
async function loadContext(sdk:Sdk,threadId:string):Promise<ItogFileContext>{
 const t=await sdk.threads.get({threadId}) as {environmentId?:string|null};
 if(!t?.environmentId)return {};
 const e=await sdk.environments.get({environmentId:t.environmentId}) as {hostId?:string;path?:string|null};
 return {environmentId:t.environmentId,hostId:e?.hostId??null,root:e?.path??null};
}
function useFileContext(threadId:string){
 const sdk=useSdk();const [ctx,setCtx]=useState<ItogFileContext|null>(null);
 useEffect(()=>{let alive=true;
  let p=contexts.get(threadId);if(!p){p=loadContext(sdk,threadId).catch(()=>{contexts.delete(threadId);return {};});contexts.set(threadId,p);}
  void p.then(c=>{if(alive)setCtx(c);});return()=>{alive=false;};},[sdk,threadId]);
 return ctx;
}

function OpenFile({path,target,line,label}:{path:string;target:ItogFileTarget;line:number|null;label:ReactNode}){
 const tr=useText();
 const nav=useBbNavigate();
 const external=experimental_useCanOpenFileExternally(target);
 const location=line?{kind:'line' as const,line,column:null}:null;
 const where=target.kind==='workspace'?tr("the_thread_workspace"):tr("this_computer");
 return <>
  <FileLink className="kmi-file-open" target={target} location={location} aria-label={tr("open_file", path)} title={tr("open_a_file_from_in_bb", where)}>{label}</FileLink>
  {external&&<button type="button" className="kmi-ext" onClick={()=>nav.experimental_openFileExternally({target,location})} title={tr("open_the_file_in_its_default")}>{tr("open_in_system")}</button>}
 </>;
}
function FileName({path,label,ctx}:{path:string;label:ReactNode;ctx:ItogFileContext|null}){
 const lang=useLanguage();
 const link=useMemo(()=>ctx?itogFileLink(path,ctx,lang):null,[path,ctx,lang]);
 if(link?.target&&canOpenItogFile(link))return <OpenFile path={path} target={link.target} line={link.line} label={label}/>;
 return <span className="kmi-file-text" title={link?`${link.why}. ${path}`:path}>{label}</span>;
}

function ItogFence({code,status,index,message,Original}:FenceProps){
 const tr=useText();
 const theme=useItogTheme();
 const composers=useComposers();
 const streaming=status==='streaming';
 const itog=useMemo(()=>parseItog(code,{streaming}),[code,streaming]);
 const verdict=useMemo(()=>judgeItog(itog),[itog]);
 const ctx=useFileContext(message.threadId);
 const sdk=useSdk();
 // Запасной путь, если отправка недоступна: вставить в поле ввода этого треда.
 const onAnswer=useCallback((text:string)=>{
  const c=composers.find(x=>x.scope.kind==='thread'&&x.scope.threadId===message.threadId)??composers[0];
  if(!c)return false;
  try{c.insert(text,{at:'end',block:true});c.focus?.();return true;}catch{return false;}
 },[composers,message.threadId]);
 // Клик по варианту: ответ сразу уходит в тред. Идёт ход агента: встаёт в очередь за ним.
 // Поле ввода пользователя не трогаем, его черновик остаётся как был.
 const onSend=useCallback(async(text:string,shown:string,askIndex:number):Promise<SendDelivery>=>{
  const key=itogAnswerKey(message.id,index,askIndex);
  if(sent.get(key)!==null)return 'sent';
  if(inflight.has(key))throw new Error(tr("answer_is_already_sending"));
  inflight.add(key);
  try{
   const r=await sdk.threads.send({threadId:message.threadId,input:[{type:'text',text}],mode:'queue-if-active'} as Parameters<typeof sdk.threads.send>[0]) as {delivery?:string};
   sent.mark(key,shown);
   return r?.delivery==='queued'?'queued':'sent';
  }finally{inflight.delete(key);}
 },[sdk,message.id,message.threadId,index,tr]);
 const sentFor=useCallback((askIndex:number)=>sent.get(itogAnswerKey(message.id,index,askIndex)),[message.id,index]);
 const onCopyPath=useCallback(async(path:string)=>{
  try{if(await experimental_copyToClipboard({text:path}))return true;}catch{/* ниже запасной путь */}
  try{await navigator.clipboard.writeText(path);return true;}catch{return false;}
 },[]);
 const renderFile=useCallback((path:string,label:ReactNode)=><FileName path={path} label={label} ctx={ctx}/>,[ctx]);
 // Блок дописан, а итога нет: показываем то, что написал агент, как обычный код.
 if(!streaming&&verdict.level==='broken')return <Original/>;
 return <ItogCard itog={itog} verdict={verdict} streaming={streaming} theme={theme} onSend={onSend} sentFor={sentFor} onAnswer={onAnswer} Field={VoiceField} onCopyPath={onCopyPath} renderFile={renderFile} original={<Original/>}/>;
}

/** Рисует блоки ```itog``` в ответах агентов карточкой. Без плагина BB покажет обычный код-блок. */
export function registerItog(app:PluginApp){
 app.slots.experimental_codeFenceRenderer({id:'itog',languages:['itog'],component:ItogFence as never});
}
