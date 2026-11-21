import {useEffect,useId,useRef,useState,type Dispatch,type KeyboardEvent,type SetStateAction} from 'react';
import {useLanguage,useText} from './i18n-ui';
import {translator,type MessageKey} from './i18n.ts';
import {SKILL_CATEGORIES,recommendSkills,skillNameKey,type CatalogSkill,type SkillOrigin} from './skill-categories';
import type {Role} from './model';

/** Recommendations stay short: closest to the user first, the full list is in the categories below. */
const RECOMMENDED_LIMIT=6;
const ORIGIN_RANK: Record<SkillOrigin,number> = {project:0,user:1,plugin:2};
export type PickerKind = 'skills' | 'tools';
export type LoadSkillCatalog = () => Promise<CatalogSkill[]>;
const TOOL_GROUPS = [
 {title:'picker_files', entries:['picker_project_files','picker_documents']},
 {title:'picker_browser', entries:['picker_browser','picker_screenshots']},
 {title:'picker_web', entries:['picker_web_search','picker_page_reading']},
 {title:'picker_terminal', entries:['picker_terminal','picker_tests']},
 {title:'picker_data', entries:['picker_spreadsheets','picker_exports']},
 {title:'picker_media', entries:['picker_image_editor','picker_av_editor']},
 {title:'picker_connectors', entries:['picker_mcp_servers']},
] as const;

const english = translator('en');
const TOOL_LABELS = new Map<string,MessageKey>(TOOL_GROUPS.flatMap(group=>group.entries.map(key=>[english(key),key] as const)));
export function toolLabel(name:string, tr:ReturnType<typeof translator>){
 const key=TOOL_LABELS.get(name);
 return key ? tr(key) : name;
}

interface PickerEntry {
 value: string;
 label: string;
 description?: string;
 origin?: SkillOrigin;
}

type CatalogState = {status:'loading'|'error'} | {status:'ready';skills:CatalogSkill[]};
export function RolePicker({kind,role,loadSkills,initialSkills,selected,setSelected,onClose}:{
 kind:PickerKind;role:Pick<Role,'id'|'role'|'custom'>;loadSkills?:LoadSkillCatalog;initialSkills?:CatalogSkill[];
 selected:string[];setSelected:Dispatch<SetStateAction<string[]>>;onClose:()=>void;
}){
 const tr=useText();
 const lang=useLanguage();
 const title=useId();
 const searchRef=useRef<HTMLInputElement>(null);
 const panelRef=useRef<HTMLElement>(null);
 const [search,setSearch]=useState('');
 const [manual,setManual]=useState('');
 const [remoteCatalog,setRemoteCatalog]=useState<CatalogState>(()=>loadSkills?{status:'loading'}:{status:'ready',skills:[]});
 const catalog:CatalogState=initialSkills?{status:'ready',skills:initialSkills}:remoteCatalog;
 useEffect(()=>{searchRef.current?.focus();},[]);
 useEffect(()=>{
  if(kind!=='skills'||initialSkills||!loadSkills)return;
  let active=true;
  setRemoteCatalog({status:'loading'});
  loadSkills().then(skills=>{if(active)setRemoteCatalog({status:'ready',skills});})
   .catch(()=>{if(active)setRemoteCatalog({status:'error'});});
  return ()=>{active=false;};
 },[kind,initialSkills,loadSkills]);

 const query=search.trim().toLocaleLowerCase(lang);
 const matches=(entry:PickerEntry)=>`${entry.label} ${entry.description??''}`.toLocaleLowerCase(lang).includes(query);
 const searching=!!query;
 const skills=catalog.status==='ready'?catalog.skills:[];
 const asEntry=(skill:CatalogSkill):PickerEntry=>({...skill,value:skill.name,label:skill.name});
 const recommended=kind==='skills'?[...recommendSkills(skills,role)].sort((a,b)=>ORIGIN_RANK[a.origin]-ORIGIN_RANK[b.origin]).map(asEntry).filter(matches).slice(0,RECOMMENDED_LIMIT):[];
 const groups=(kind==='skills'
  ? SKILL_CATEGORIES.map(category=>({title:`picker_${category}` as const, entries:skills.filter(s=>s.category===category).map(asEntry)}))
  : TOOL_GROUPS.map(group=>({title:group.title,entries:group.entries.map(key=>({value:english(key),label:tr(key)}))})))
  .map(group=>({...group,entries:group.entries.filter(matches)})).filter(group=>group.entries.length);

 const keyOf=kind==='skills'?skillNameKey:(value:string)=>value;
 const selectedKeys=new Set(selected.map(keyOf));
 const addValue=()=>{
  const value=manual.trim();
  if(!value)return;
  setSelected(items=>items.some(item=>keyOf(item)===keyOf(value))?items:[...items,value]);
  setManual('');
 };
 const renderRows=(entries:PickerEntry[])=><ul>{entries.map(entry=>{
  const key=keyOf(entry.value);
  const pressed=selectedKeys.has(key);
  return <li key={key}><button type="button" className="km-picker-row" aria-pressed={pressed} onClick={()=>setSelected(items=>
   items.some(item=>keyOf(item)===key)?items.filter(item=>keyOf(item)!==key):[...items,entry.value])}>
   <span className="km-picker-summary"><b>{entry.label}</b>{entry.description&&<small title={entry.description}>{entry.description}</small>}</span>
   {entry.origin&&<span className="km-picker-origin">{tr(`picker_origin_${entry.origin}`)}</span>}
   <span className="km-picker-toggle" aria-hidden="true">{pressed?'✓':'+'}</span>
  </button></li>;
 })}</ul>;
 const onKeyDown=(event:KeyboardEvent<HTMLElement>)=>{
  if(event.key==='Escape'){
   event.preventDefault();
   event.stopPropagation();
   onClose();
  }
  if(event.key!=='Tab')return;
  const focusable=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,summary,a[href]')??[])
   .filter(element=>element.getClientRects().length);
  const edge=event.shiftKey?focusable.at(0):focusable.at(-1);
  if(event.target!==edge)return;
  event.preventDefault();
  (event.shiftKey?focusable.at(-1):focusable.at(0))?.focus();
 };
 const skillsReady=kind==='skills'&&catalog.status==='ready';
 return <section ref={panelRef} className="km-picker" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={onKeyDown}>
  <header className="km-picker-head"><h2 id={title}>{tr(kind==='skills'?'picker_add_skills':'picker_add_tools')}</h2>
   <button type="button" className="km-picker-close" aria-label={tr('close')} onClick={onClose}>×</button>
  </header>
  <input ref={searchRef} className="km-picker-search" type="search" aria-label={tr(kind==='skills'?'picker_search_skills':'picker_search_tools')}
   placeholder={tr(kind==='skills'?'picker_search_skills':'picker_search_tools')} value={search} onChange={event=>setSearch(event.target.value)}/>
  <div className="km-picker-list">
   {kind==='skills'&&catalog.status==='loading'&&<p role="status">{tr('loading')}</p>}
   {kind==='skills'&&catalog.status==='error'&&<p role="alert">{tr('picker_load_error')}</p>}
   {skillsReady&&!skills.length&&<div className="km-picker-empty"><strong>{tr('picker_empty')}</strong><p>{tr('picker_empty_next')}</p></div>}
   {(kind==='tools'||(skillsReady&&skills.length>0))&&!groups.length&&<p role="status">{tr('picker_no_matches')}</p>}
   {!!recommended.length&&<section className="km-picker-recommended"><h3>{tr('picker_recommended')}</h3>{renderRows(recommended)}</section>}
   {groups.map((group,index)=><details key={`${group.title}-${searching}`} className="km-picker-group" open={searching||(kind==='tools'&&index===0)}>
    <summary>{tr(group.title)}<b>{group.entries.length}</b></summary>
    {renderRows(group.entries)}
   </details>)}
  </div>
  <footer className="km-picker-foot">
   {kind==='tools'&&<p>{tr('picker_tools_note')}</p>}
   <form className="km-chip-add" onSubmit={event=>{event.preventDefault();addValue();}}>
    <input aria-label={tr(kind==='skills'?'skill_name':'picker_tool_label')} placeholder={tr(kind==='skills'?'skill_name':'picker_tool_label')} value={manual} onChange={event=>setManual(event.target.value)}/>
    <button type="submit" disabled={!manual.trim()}>{tr('add_2')}</button>
   </form>
   {kind==='skills'&&<nav className="km-picker-links" aria-label={tr('picker_skill_resources')}>
    <a href="https://skills.sh" target="_blank" rel="noopener noreferrer">{tr('picker_find_skills')}</a>
    <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer">{tr('picker_anthropic_skills')}</a>
   </nav>}
  </footer>
 </section>;
}
