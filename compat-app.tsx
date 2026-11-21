import {OfficeLanguage, useLanguage} from './i18n-ui';
import {DEFAULT_LANGUAGE,translator,text as tr,type Language} from './i18n.ts';
import {useEffect,useRef,useState} from 'react';
import {useRpc,useRealtime} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
// Страховка в приложении: каждый кусок регистрирует слоты через guardApp, тогда
// ошибка при регистрации отключает только его, а ошибка при отрисовке показывает
// запасной вид (исходный код-блок, кнопку «Закрыть» у формы или ничего).
import {Component,createElement,type ComponentType,type ReactNode} from 'react';
import {definePluginApp} from '@get-bb/plugin-sdk/app';
import {APP_NEEDS,Health,type FeatureId} from './compat';

type PluginApp=Parameters<Parameters<typeof definePluginApp>[0]>[0];
type AnyProps=Record<string,unknown>;

export const appHealth=new Health(msg=>console.warn(msg));

/** Запасной вид при падении: исходный код-блок, закрытие формы или ничего. */
function fallbackFor(id:FeatureId,props:AnyProps,language:Language):ReactNode{
 const tr=translator(language);
 if(id==='pass'&&typeof props.source==='string')return createElement('code',null,props.source);
 if(id==='pass')return createElement('p',{role:'alert'},tr("handoffs_temporarily_unavailable"));
 const Original=props.Original as ComponentType|undefined;
 if(Original)return createElement(Original);
 const cancel=props.cancel as (()=>Promise<void>)|undefined;
 if(cancel)return createElement('div',{className:'km',style:{padding:10}},
  createElement('p',{role:'alert'},tr("could_not_open_the_cyber_office", id)),
  createElement('button',{type:'button',onClick:()=>void cancel()},tr("close")));
 if(id==='office')return createElement('div',{className:'km km-page'},createElement('p',{role:'alert'},tr("the_office_could_not_load_run")));
 return null;
}

class Boundary extends Component<{id:FeatureId;props:AnyProps;children?:ReactNode;language:Language},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:unknown){appHealth.fail(this.props.id,e);}
 render(){return this.state.failed?fallbackFor(this.props.id,this.props.props,this.props.language):this.props.children;}
}

const wrapped=new WeakMap<object,ComponentType<AnyProps>>();
/** Компонент в обёртке: падение рисует запасной вид, а не роняет экран BB. */
export function guard<P extends object>(id:FeatureId,C:ComponentType<P>):ComponentType<P>{
 const hit=wrapped.get(C as object);if(hit)return hit as unknown as ComponentType<P>;
 const G=(props:P)=>createElement(Boundary,{id,props:props as AnyProps,language:useLanguage()},createElement(C as ComponentType<AnyProps>,props as AnyProps));
 G.displayName=`Guard(${id})`;wrapped.set(C as object,G as ComponentType<AnyProps>);
 return G;
}
export function useStoredLanguage(){
 const rpc=useRpc<typeof rpcContract>();
 const [language,setLanguage]=useState<Language>(DEFAULT_LANGUAGE);
 const version=useRef(0);
 useEffect(()=>{
  let alive=true;const reading=version.current;
  void rpc.call('getLanguage',null).then(value=>{if(alive&&reading===version.current)setLanguage(value);}).catch(()=>{});
  return()=>{alive=false;};
 },[rpc]);
 useRealtime('language-changed',(value:unknown)=>{
  if(value==='en'||value==='ru'){version.current++;setLanguage(value);}
 });
 return language;
}

function localizedSlot(C:ComponentType<AnyProps>){
 const Slot=function LocalizedSlot(props:AnyProps){
  const language=useStoredLanguage();
  return createElement(OfficeLanguage.Provider,{value:language},createElement(C,props));
 };
 Slot.displayName=C.displayName;
 return Slot;
}

const COMPONENT_KEYS=['component','summary','details'];
function wrapRegistration(id:FeatureId,reg:unknown):unknown{
 if(!reg||typeof reg!=='object')return reg;
 const out:AnyProps={...(reg as AnyProps)};
 for(const k of COMPONENT_KEYS)if(typeof out[k]==='function')out[k]=localizedSlot(guard(id,out[k] as ComponentType<AnyProps>));
 if(typeof out.run==='function'){const run=out.run as (...a:unknown[])=>unknown;out.run=async(...a:unknown[])=>{try{await run(...a);}catch(e){console.warn(tr("cyber_office_action_failed", id),e);}};}
 return out;
}
/** app, у которого каждый слот обёрнут страховкой куска. */
function guardedApp(app:PluginApp,id:FeatureId):PluginApp{
 const slots=new Proxy(app.slots as object,{get(t,k){
  const f=(t as AnyProps)[k as string];
  return typeof f==='function'?(reg:unknown,...rest:unknown[])=>(f as (...a:unknown[])=>unknown).call(t,wrapRegistration(id,reg),...rest):f;
 }});
 return new Proxy(app as object,{get(t,k){return k==='slots'?slots:(t as AnyProps)[k as string];}}) as PluginApp;
}
/** Регистрирует кусок: проверка нужного из BB, обёртки слотов, отключение при ошибке. */
export function feature(app:PluginApp,id:FeatureId,register:(app:PluginApp)=>void){
 return appHealth.run(id,app,APP_NEEDS[id],()=>register(guardedApp(app,id)))!==null;
}
