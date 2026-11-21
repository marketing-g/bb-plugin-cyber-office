import {DEFAULT_LANGUAGE,translator,type Language} from './i18n.ts';
// Страховка от обновлений BB. Одно место, где записано, на что из BB опирается
// каждый кусок плагина, и как кусок отключается сам, если BB это убрал или сломал.
// После обновления BB: `npm run check-after-update`, при поломке смотреть сюда.

/** Кусок плагина: офис, блок в треде, итог, правила итога, разнос, киборги. */
export type FeatureId='office'|'roster-tools'|'thread-index'|'thread-block'|'itog'|'itog-ask'|'itog-rules'|'route'|'kiborgi'|'dispatch'|'foreman'|'pass'|'ask'|'scout'|'show';

/** Сервер: пути в объекте `bb`, которые должны быть функциями. */
export const SERVER_NEEDS:Partial<Record<FeatureId,readonly string[]>>={
 pass:['rpc.register','storage.kv.get','storage.kv.set','storage.kv.list','realtime.publish'],
 office:['rpc.register','sdk.threads.list','sdk.threads.get','sdk.threads.defaultExecutionOptions','storage.kv.get','storage.kv.set','storage.kv.delete','realtime.publish'],
 'thread-index':['background.service','sdk.subscribe','sdk.threads.list','sdk.threads.get'],
 'roster-tools':['agents.registerTool','agents.configure'],
 'itog-rules':['agents.contributeInstructions'],
 route:['ui.requestInput','sdk.threads.send','sdk.threads.promptHistory','sdk.threads.get','agents.registerTool','storage.kv.list'],
 ask:['agents.registerTool','ui.requestInput'],
 // Радар: запуск по сигналу доски и раз в неделю.
 scout:['background.schedule','onDispose','sdk.threads.get','sdk.threads.spawn','storage.kv.get','storage.kv.set','storage.kv.list'],
 // Диспетчер: доска, раздача, смена караула (заполнение контекста из threads.context, ход из события thread.idle).
 dispatch:['events.on','agents.registerTool','sdk.threads.spawn','sdk.threads.context','sdk.threads.archive','sdk.threads.update','sdk.threads.send','sdk.threads.list','sdk.threads.get','storage.kv.list'],
 // Показ: настоящий прогон в проекте «Демо», треды по цепочке, стоп по кнопке и потолку денег.
 show:['events.on','onDispose','sdk.projects.list','sdk.threads.spawn','sdk.threads.get','sdk.threads.output','sdk.threads.context','sdk.threads.stop','storage.kv.get','storage.kv.set','realtime.publish'],
 foreman:['background.schedule','events.on','onDispose','sdk.threads.get','sdk.threads.events.list','sdk.threads.output','sdk.threads.send','storage.kv.list','storage.kv.get','storage.kv.set','realtime.publish'],
};
/** Приложение: пути в объекте `app`, которые должны быть функциями. */
export const APP_NEEDS:Partial<Record<FeatureId,readonly string[]>>={
 pass:['slots.messageDirective'],
 office:['slots.navPanel','slots.homepageSection'],
 'thread-block':['slots.experimental_threadContextCardSection','slots.experimental_threadInfoSection','slots.experimental_threadContextSegment','slots.messageDirective'],
 itog:['slots.experimental_codeFenceRenderer'],
 'itog-ask':['slots.messageAction'],
 route:['slots.pendingInteraction','slots.experimental_appOverlay','slots.messageAction'],
 // Возраст ожидания дополняет существующий Rail, собственных слотов не требует.
 foreman:[],
 ask:['slots.pendingInteraction'],
};

/** Пути, которых нет или которые не функции. */
export function missing(root:unknown,paths:readonly string[]=[]):string[]{
 return paths.filter(p=>{
  let cur:unknown=root;
  for(const k of p.split('.')){if(cur==null)return true;try{cur=(cur as Record<string,unknown>)[k];}catch{return true;}}
  return typeof cur!=='function';
 });
}

export interface FeatureState {id:FeatureId;ok:boolean;error?:string}
const short=(e:unknown)=>String((e as Error)?.message??e).slice(0,300);

/** Журнал кусков: какой включился, какой отключился и почему. */
export class Health {
 private states=new Map<FeatureId,FeatureState>();
 constructor(private log:(msg:string)=>void=()=>{}){}
 /** Проверяет нужное из BB и регистрирует кусок. Ошибка отключает только этот кусок. */
 run<T>(id:FeatureId,root:unknown,needs:readonly string[]|undefined,register:()=>T):T|null{
  const miss=missing(root,needs);
  if(miss.length){this.fail(id,translator(DEFAULT_LANGUAGE)('feature_missing_capability',miss.join(', ')));return null;}
  try{const out=register();if(!this.states.has(id))this.states.set(id,{id,ok:true});return out;}
  catch(e){this.fail(id,short(e));return null;}
 }
 fail(id:FeatureId,error:unknown){const msg=typeof error==='string'?error:short(error);this.states.set(id,{id,ok:false,error:msg});this.log('[cyber-office] '+translator(DEFAULT_LANGUAGE)('feature_unavailable',id,msg));}
 ok(id:FeatureId){return this.states.get(id)?.ok??false;}
 list():FeatureState[]{return [...this.states.values()];}
}

/** Обработчик RPC выключенного куска: честная ошибка вместо падения. */
export function offHandler(id:FeatureId,health:Health,getLanguage?:()=>Promise<Language>){
 return async()=>{const tr=translator(await getLanguage?.()??DEFAULT_LANGUAGE);throw new Error(tr('feature_unavailable',id,health.list().find(s=>s.id===id)?.error??tr('feature_not_registered')));};
}

import type {BbPluginApi} from "@get-bb/plugin-sdk";
import type {Brains} from "./model";

export async function availableProviders(bb:BbPluginApi):Promise<Set<string>|null>{
 if(missing(bb,["sdk.providers.list"]).length)return null;
 try{return new Set((await bb.sdk.providers.list()).filter(p=>p.available).map(p=>p.id));}
 catch{return null;}
}

export async function roleExecution(bb:BbPluginApi,projectId:string,brains:Brains,available?:boolean){
 if(brains.providerId&&available!==false)return {providerId:brains.providerId,model:brains.modelId??"",reasoningLevel:brains.effort};
 if(missing(bb,["sdk.projects.defaultExecutionOptions"]).length)return null;
 try{
  const defaults=await bb.sdk.projects.defaultExecutionOptions({projectId});
  return defaults?{providerId:defaults.providerId,model:defaults.model,reasoningLevel:defaults.reasoningLevel}:null;
 }catch{return null;}
}
