import {DEFAULT_LANGUAGE,translator,type Language} from './i18n';
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {ASK_FORM_ID,askParameters,askWindow,defaultAskAnswer,parseAsk,resolveAskAnswer} from './ask';

export const ASK_TOOLS=['team_ask'] as const;
export function registerAskServer(bb:BbPluginApi,{now=Date.now,getLanguage}:{now?:()=>number;getLanguage?:()=>Promise<Language>}={}){
 const pending=new Set<string>();
 bb.agents.registerTool({
  name:'team_ask',
  description:'Ask one question in the thread composer. Give 2–4 single-choice options with labels up to 60 characters and a defaultId. Use HH:MM today on the BB computer, or allow six hours by default. Check project context first under R2 and say where you looked. Use absolute image paths on the thread host. Returns {answer: id or null, text, by: click|own|default}. Omit the question from the result block.',
  parameters:askParameters,
  async execute(raw,ctx){
   const lang=await getLanguage?.()??DEFAULT_LANGUAGE;
   const tr=translator(lang);
   const input=parseAsk(raw,lang);
   ctx.signal.throwIfAborted();
   if(!ctx.threadId)throw new Error(tr('ask_thread_required'));
   if(pending.has(ctx.threadId))throw new Error(tr('ask_already_pending'));
   const window=askWindow(input,now());
   if(now()>=window.expiresAt)return JSON.stringify(defaultAskAnswer(input,window));
   pending.add(ctx.threadId);
   try{
    const result=await bb.ui.requestInput({
     threadId:ctx.threadId,rendererId:ASK_FORM_ID,title:tr('ask_question'),
     payload:{...input,...window},timeoutMs:Math.max(1,window.expiresAt-now()),
     presentation:{label:{pending:tr('ask_waiting'),completed:tr('ask_received')}},
     describeSubmission:value=>({title:tr('ask_received'),detail:resolveAskAnswer(input,window,value,now()).text}),
    },{signal:ctx.signal});
    ctx.signal.throwIfAborted();
    if(result.outcome==='submitted')return JSON.stringify(resolveAskAnswer(input,window,result.value,now()));
    if(result.reason==='timeout')return JSON.stringify(defaultAskAnswer(input,window));
    throw new Error(tr('ask_cancelled',result.reason));
   }finally{pending.delete(ctx.threadId);}
  },
 });
}
