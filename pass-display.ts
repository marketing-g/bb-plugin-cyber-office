import {DEFAULT_LANGUAGE,dataText,translator} from './i18n.ts';
import roster from './team.json' with {type:'json'};
import type {ProjectPass} from './pass-log';

export const PASS_EVENT='passes-changed';
export const PASS_THREAD=/^thr_[a-z0-9]{4,40}$/;
export interface PassDirective {from:string;via?:string;to:string;task:string;at:string;thread:string}
export const PASS_NAMES:Readonly<Record<string,string>>=Object.fromEntries([['user','вы'],...roster.roles.map(r=>[r.id,r.name])]);
export function passName(id:string,lang=DEFAULT_LANGUAGE){return /^shift:\d+$/.test(id)?translator(lang)('shift_name',id.slice(6)):Object.hasOwn(PASS_NAMES,id)?dataText(lang,PASS_NAMES[id]):id;}
export function passTime(at:number){return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}).format(at);}
export function parsePassDirective(a:Readonly<Record<string,string>>):PassDirective|null{
 const {from,to,via,task,at,thread}=a;
 if(!Object.hasOwn(PASS_NAMES,from)||!Object.hasOwn(PASS_NAMES,to)||(via!==undefined&&!Object.hasOwn(PASS_NAMES,via))||!task?.trim()||task.length>300||!PASS_THREAD.test(thread??'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(at??''))return null;
 return {from,to,...(via?{via}:{}),task,at,thread};
}
export function groupPasses(events:readonly ProjectPass[]){
 const groups=new Map<string,{boardId:string;task:string;events:ProjectPass[]}>();
 for(const e of [...events].sort((a,b)=>b.at-a.at)){
  const key=JSON.stringify([e.boardId,e.task]);let g=groups.get(key);
  if(!g){g={boardId:e.boardId,task:e.task,events:[]};groups.set(key,g);}g.events.push(e);
 }
 return [...groups.values()];
}
