import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {skillCategory,skillNameKey,type CatalogSkill,type SkillOrigin} from './skill-categories.ts';

type ListSkills = BbPluginApi['sdk']['skills']['list'];
type InstalledSkill = Awaited<ReturnType<ListSkills>>['skills'][number];
type SkillMetadata = Pick<InstalledSkill,'name'|'description'|'scope'>;

const ORIGINS: Record<InstalledSkill['scope'], SkillOrigin> = {
 'bb-project':'project', 'provider-project':'project', 'shared-project':'project',
 'bb-user':'user', 'provider-user':'user', 'shared-user':'user', 'bb-builtin':'plugin', plugin:'plugin',
};
const PRIORITY: Record<SkillOrigin,number> = {project:0, user:1, plugin:2};
export const SKILL_CATALOG_LIMIT = 500;
const CACHE_MS = 60_000;

export function normalizeSkillCatalog(rows: readonly SkillMetadata[], includeProject: boolean): CatalogSkill[] {
 const catalog = new Map<string,CatalogSkill>();
 for(const row of rows){
  const origin = ORIGINS[row.scope];
  if(origin === 'project' && !includeProject)continue;
  const name = row.name.trim();
  if(!name || /[\r\n]/.test(name))continue;
  const key = skillNameKey(name);
  const previous = catalog.get(key);
  if(previous && PRIORITY[previous.origin] <= PRIORITY[origin])continue;
  const summary = (row.description ?? '').replace(/\s+/gu,' ').trim();
  const description = [...summary].slice(0,160).join('').trimEnd();
  catalog.set(key,{name,description,origin,category:skillCategory(name,summary)});
 }
 // Preserve source priority when the union of installed skills exceeds the limit.
 return [...catalog.values()].sort((a,b)=>PRIORITY[a.origin]-PRIORITY[b.origin] || a.name.localeCompare(b.name,'en'))
  .slice(0,SKILL_CATALOG_LIMIT).sort((a,b)=>a.name.localeCompare(b.name,'en'));
}

export function createSkillCatalog({read,now=Date.now}:{
 read: (projectId?: string) => Promise<readonly SkillMetadata[]>;
 now?: () => number;
}){
 const cache = new Map<string|undefined,{expires:number;result:Promise<CatalogSkill[]>}>();
 return (projectId?: string) => {
  const time = now();
  const cached = cache.get(projectId);
  if(cached && cached.expires > time)return cached.result;
  for(const [key,entry] of cache)if(entry.expires <= time)cache.delete(key);
  const result = Promise.resolve().then(()=>read(projectId))
   .then(rows=>normalizeSkillCatalog(rows,projectId!==undefined))
   .catch(error=>{if(cache.get(projectId)?.result===result)cache.delete(projectId);throw error;});
  cache.set(projectId,{expires:time+CACHE_MS,result});
  return result;
 };
}

export async function readInstalledSkills(sdk: BbPluginApi['sdk'], projectId?: string): Promise<readonly SkillMetadata[]> {
 // The SDK lists installed metadata in a workspace. Use BB's personal project for an unscoped read.
 const workspace = projectId ?? (await sdk.projects.list({includePersonal:true})).find(project=>project.kind==='personal')?.id;
 if(!workspace)return [];
 const {skills} = await sdk.skills.list({projectId:workspace,environmentId:null});
 return skills;
}
