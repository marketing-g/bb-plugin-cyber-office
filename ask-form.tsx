import {useText} from './i18n-ui';
import {Component,useEffect,useRef,useState,type ReactNode} from 'react';
import {definePluginApp,experimental_FilePreview as FilePreview,experimental_FileLink as FileLink,experimental_useCodeTheme,useSdk,type PluginPendingInteractionProps,type ExperimentalLiveFileTarget} from '@get-bb/plugin-sdk/app';
import {ASK_FORM_ID,absoluteImagePath,parseAsk,type AskPayload,type AskSubmission} from './ask';
import {VoiceField} from './voice-field';
import './ask.css';

type PluginApp=Parameters<Parameters<typeof definePluginApp>[0]>[0];
function PreviewUnavailable(){const tr=useText();return <span>{tr("preview_unavailable")}</span>;}
class PreviewBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<PreviewUnavailable/>:this.props.children;}
}
/** Как в itog-app: реальная машина берётся из окружения треда, id не угадываем. */
function useImageHost(threadId:string){
 const sdk=useSdk();const [host,setHost]=useState<{threadId:string;hostId:string|null}|null>(null);
 useEffect(()=>{let alive=true;
  void (async()=>{
   const thread=await sdk.threads.get({threadId});
   if(!thread.environmentId)return null;
   return (await sdk.environments.get({environmentId:thread.environmentId})).hostId;
  })().catch(()=>null).then(hostId=>{if(alive)setHost({threadId,hostId});});
  return()=>{alive=false;};
 },[sdk,threadId]);
 return host?.threadId===threadId?host.hostId:undefined;
}

export function AskForm({payload,threadId,submit}:{payload:AskPayload;threadId:string;submit:(v:AskSubmission)=>Promise<void>}){
 const tr=useText();
 const [text,setText]=useState('');const [voice,setVoice]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const sending=useRef(false);const recording=useRef(false);
 const hostId=useImageHost(threadId);
 let theme='dark';try{theme=experimental_useCodeTheme().mode;}catch{/* запасная тема */}
 const go=async(value:AskSubmission)=>{
  if(sending.current||recording.current)return;
  sending.current=true;setBusy(true);setError(null);
  try{await submit(value);}catch(e){sending.current=false;setBusy(false);setError(String((e as Error)?.message??e));}
 };
 const own=()=>{if(text.trim()&&text.trim().length<=4000)void go({by:'own',text:text.trim()});};
 return <form className="km km-ask" data-theme={theme} aria-label={tr("question_for_you")} onSubmit={e=>{e.preventDefault();own();}}>
  <h2>{payload.question}</h2>
  {payload.context&&<p className="km-ask-context">{tr("already_checked")} {payload.context}</p>}
  <ul className="km-ask-options">
   {payload.options.map(option=>{
    const image=option.image&&absoluteImagePath(option.image)?option.image:null;
    const target:ExperimentalLiveFileTarget|null=image&&hostId?{kind:'host',hostId,path:image}:null;
    const isDefault=option.id===payload.defaultId;
    return <li key={option.id} className={'km-ask-card'+(isDefault?' is-default':'')}>
     {image&&<div className="km-ask-preview" aria-hidden="true" inert>
      {target&&FilePreview?<PreviewBoundary key={image}><FilePreview target={target} renderPreview={({url})=><img src={url} alt=""/>}/></PreviewBoundary>
       :<span>{hostId===undefined?tr("loading_image"):hostId?tr("preview_unavailable"):tr("could_not_find_the_computer_holding")}</span>}
     </div>}
     <button type="button" className="km-ask-choice" disabled={busy||voice} onClick={()=>void go({by:'click',answer:option.id})}>
      {image&&<span className="km-ask-image-space" aria-hidden="true"/>}
      <span className="km-ask-caption">{option.label}{isDefault&&<small>{tr("default_until")} {payload.deadlineLabel}</small>}</span>
     </button>
     {image&&<div className="km-ask-file">{target?<FileLink target={target}>{tr("open_image")}</FileLink>:<span title={image}>{image}</span>}</div>}
    </li>;
   })}
  </ul>
  <label htmlFor={ASK_FORM_ID+'-own'}>{tr("your_own_answer")}</label>
  <VoiceField id={ASK_FORM_ID+'-own'} value={text} onValueChange={setText} disabled={busy} rows={2} placeholder={tr("type_or_dictate_an_answer")}
   onVoiceInputActiveChange={active=>{recording.current=active;setVoice(active);}}
   onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();own();}}}/>
  {error&&<p role="alert">{tr("something_went_wrong")} {error}</p>}
  {text.trim().length>4000&&<p role="alert">{tr("keep_your_answer_under_characters")}</p>}
  <button className="km-ask-send" type="submit" disabled={busy||voice||!text.trim()||text.trim().length>4000}>{busy?tr("sending_2"):tr("answer")}</button>
  <p className="km-ask-context">{voice?tr("wait_for_the_transcription"):tr("enter_to_answer_shift_enter_for")}</p>
 </form>;
}
function AskSlot({interaction,submit,cancel}:PluginPendingInteractionProps){
 const tr=useText();
 let payload:AskPayload;
 try{
  const raw=interaction.payload as unknown as AskPayload;
  payload={...parseAsk({question:raw.question,options:raw.options,defaultId:raw.defaultId,deadline:raw.deadline,context:raw.context}),expiresAt:raw.expiresAt,deadlineLabel:raw.deadlineLabel};
  if(!Number.isFinite(payload.expiresAt)||!/^\d{2}:\d{2}$/.test(payload.deadlineLabel))throw new Error(tr("no_deadline"));
 }catch{return <div className="km km-ask"><p role="alert">{tr("could_not_read_the_question")}</p><button type="button" onClick={()=>void cancel()}>{tr("close")}</button></div>;}
 return <AskForm key={interaction.id} payload={payload} threadId={interaction.threadId} submit={value=>submit(value)}/>;
}
export function registerAsk(app:PluginApp){app.slots.pendingInteraction({id:ASK_FORM_ID,component:AskSlot});}
