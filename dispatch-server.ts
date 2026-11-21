// Стас-диспетчер: доска задач, раздача исполнителям и смена караула. Подключение из server.ts:
//   const dispatch=registerDispatch(bb,{cardOf});  rpc: {...dispatch.handlers}; configure: dispatch.selection(ctx)
// Схема включается только тредам из списка `dispatch:threads` (RPC dispatcherEnable / dispatcherStart).
// Координатор из team.json включается только с явным confirmCoordinator, по умолчанию выключен.
import {mkdirSync,writeFileSync} from 'node:fs';
import {roleExecution} from './compat';
import {join} from 'node:path';
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import roster from './team.json';
import type {Role} from './model';
import {DESIGN_RULES} from './itog-rules';
import {withBoardLock} from './board-lock';
import {threadOnBoard} from './board-thread';
import {updateRowStatus} from './board-metrics';
import {logDispatchPass,logStatusPass,logShiftPass} from './pass-log';
import {DEFAULT_LANGUAGE,dataText,quoteLines,text,translator,type Language} from './i18n';
import {BOARD_STATUSES,BOARD_STATUS_TEXT,DEFAULT_DISPATCH,DISPATCHER_RULES,DISPATCH_LIMIT,DISPATCH_WINDOW,OPEN_ROW_LIMIT,SHIFT_LIMIT,SHIFT_WINDOW,boardMarkdown,isOpenRow,mergeConfig,shiftDue,type Board,type BoardRow,type DispatchConfig} from './board';

/** Роли, которым в бриф идёт Р4: эталон, один образец на приёмку, рецепт между сериями не меняется. */
export const DESIGN_ROLES:ReadonlySet<string>=new Set(['pixel','kadr','rams']);
export const DISPATCH_TOOLS=['team_dispatch','team_board_list','team_board_add','team_board_update','team_handoff','team_shift_accept'] as const;
const ENTRIES_KEY='dispatch:threads';
const BOARD_KEY='board:';
const SHIFT_KEY='shift:';
const TURNS_KEY='turns:';
const DISPATCH_HISTORY_KEY='dispatch:recent:';
export const COORD_KEY='coordinator:';
const TEST_TITLE=/^\s*(?:тест|test)\s*:/i;
const COORDINATORS=roster.coordinatorByProject as Record<string,string>;

/** Тред Стаса со включённой схемой. */
export interface DispatchEntry {board:string;config:DispatchConfig;predecessor:string|null;shift:number;acceptedAt:number|null}
/** Смена караула старого треда. */
interface ShiftState {state:'asked'|'spawned'|'accepted'|'archived'|'failed';at:number;why:string;usage:number|null;successor?:string;note?:string;error?:string}

const statusEnum=z.enum(BOARD_STATUSES);
const execSchema=z.object({providerId:z.string().min(1),model:z.string().min(1),reasoningLevel:z.string().min(1)}).strict();
const configSchema=z.object({handoffAt:z.number().min(0.005).max(0.95).optional(),handoffTurns:z.number().int().min(0).max(1000).optional(),minTurns:z.number().int().min(1).max(100).optional(),childExecution:execSchema.nullable().optional()}).strict();
const rowSchema=z.object({id:z.string(),task:z.string(),roleId:z.string(),status:statusEnum,threadId:z.string().nullable(),updatedAt:z.number(),createdAt:z.number(),note:z.string().optional(),criteria:z.string().optional(),
 critic:z.object({verdict:z.enum(['pass','rework']),by:z.string(),at:z.number()}).nullable().optional(),foremanAt:z.number().nullable().optional(),
 waitingSince:z.number().optional(),waitedMs:z.number().nonnegative().optional(),reworks:z.number().int().nonnegative().optional(),nudges:z.number().int().nonnegative().optional(),invalidThread:z.boolean().optional(),
 live:z.object({status:z.string(),title:z.string().nullable(),pending:z.boolean(),archived:z.boolean()}).nullable().optional()});
const boardSchema=z.object({id:z.string(),projectId:z.string(),title:z.string(),primary:z.boolean(),currentThreadId:z.string(),shifts:z.array(z.string()),rows:z.array(rowSchema),
 handoff:z.object({from:z.string(),to:z.string().nullable(),note:z.string(),at:z.number(),usage:z.number().nullable()}).nullable().optional(),updatedAt:z.number(),
 config:z.object({handoffAt:z.number(),handoffTurns:z.number()}).optional(),mirror:z.string().nullable().optional(),shiftBlockedUntil:z.number().optional()});
const entryOut=z.object({threadId:z.string(),board:z.string(),config:z.object({handoffAt:z.number(),handoffTurns:z.number(),minTurns:z.number(),childExecution:execSchema.nullable().optional()}),predecessor:z.string().nullable(),shift:z.number(),acceptedAt:z.number().nullable()});

export const dispatchRpc={
 /** Доски проекта: строки со статусом треда. Для клика по Стасу в офисе. */
 getBoards:{input:z.object({projectId:z.string().min(1)}).strict(),output:z.object({boards:z.array(boardSchema)})},
 /** Поднять нового Стаса-диспетчера (песочница): тред без родителя, схема включена до старта сессии. */
 dispatcherStart:{input:z.object({projectId:z.string().min(1),title:z.string().min(1).max(120),environmentId:z.string().min(1),providerId:z.string().min(1),model:z.string().min(1),reasoningLevel:z.string().min(1),prompt:z.string().min(1).max(20000),config:configSchema.optional()}).strict(),
  output:entryOut},
 /** Включить схему существующему треду или поменять пороги. Координатор только с confirmCoordinator = его id. */
 dispatcherEnable:{input:z.object({threadId:z.string().min(1),config:configSchema.optional(),confirmCoordinator:z.string().optional()}).strict(),output:entryOut.extend({note:z.string()})},
 dispatcherDisable:{input:z.object({threadId:z.string().min(1)}).strict(),output:z.object({threadId:z.string(),disabled:z.boolean()})},
 /** Перенос на доску вручную (перевод живого координатора на схему): строки задач и заметка, которая войдёт в передачу следующей смене. Повтор той же открытой задачи пропускается. */
 boardImport:{input:z.object({boardId:z.string().min(1),rows:z.array(z.object({task:z.string().min(1).max(300),role:z.string().min(1).max(40),threadId:z.string().optional(),status:statusEnum.optional(),note:z.string().max(400).optional()}).strict()).max(50),carry:z.string().max(6000).optional()}).strict(),
  output:z.object({board:z.string(),added:z.array(z.string()),skipped:z.number(),open:z.number(),carry:z.boolean()})},
 /** Состояние диспетчера: заполнение контекста, ходы, смена. */
 dispatcherStatus:{input:z.object({threadId:z.string().min(1)}).strict(),output:z.object({entry:entryOut.nullable(),turns:z.number(),usage:z.object({usedTokens:z.number().nullable(),window:z.number().nullable(),estimated:z.boolean()}).nullable(),shift:z.unknown().nullable(),due:z.object({due:z.boolean(),ratio:z.number().nullable(),why:z.string()})})},
};
type Handlers={[K in keyof typeof dispatchRpc]:(input:z.infer<(typeof dispatchRpc)[K]['input']>)=>Promise<z.infer<(typeof dispatchRpc)[K]['output']>>};

interface Options {getLanguage?:()=>Promise<Language>;
 experimental?:()=>Promise<boolean>;
 /** Карточка роли с настройками пользователя. */
 cardOf:(role:string)=>Promise<Role|null>;
 now?:()=>number;
 /** Папка зеркал доски. По умолчанию <dataDir>/plugins/cyber-office/doska. */
 mirrorDir?:string|null;
}
const rid=()=>Math.random().toString(36).slice(2,10);
const short=(e:unknown)=>String((e as Error)?.message??e).slice(0,300);
const baseTitle=(t:string|null|undefined)=>(t||'Stas').replace(/\s*·\s*(?:смена|shift)\s+\d+\s*$/i,'').trim();

export function registerDispatch(bb:BbPluginApi,opts:Options){
 const now=opts.now??Date.now;
 const language=async()=>await opts.getLanguage?.()??DEFAULT_LANGUAGE;
 const locale=async()=>translator(await language());
 const entries=new Map<string,DispatchEntry>();
 /** Метки новых тредов, которым схема включается до того, как известен их id. */
 const nonces=new Set<string>();
 const ready=(async()=>{try{const saved=await bb.storage.kv.get<Record<string,DispatchEntry>>(ENTRIES_KEY);for(const [k,v] of Object.entries(saved??{}))entries.set(k,{...v,config:mergeConfig(DEFAULT_DISPATCH,v.config),acceptedAt:v.acceptedAt??(v.predecessor?null:0)});}catch(e){bb.log?.warn?.('[cyber-office dispatch] список: '+short(e));}})();
 const saveEntries=()=>bb.storage.kv.set(ENTRIES_KEY,Object.fromEntries(entries));
 let mirrorDir:string|null=null;
 try{mirrorDir=opts.mirrorDir!==undefined?opts.mirrorDir:join(bb.server.experimental_dataDir,'plugins',bb.pluginId,'doska');}catch{mirrorDir=null;}
 const mirrorPath=(id:string)=>mirrorDir?join(mirrorDir,id+'.md'):null;

 // Один поток на доску и на тред: инструменты и события не перетирают друг друга.
 const locks=new Map<string,Promise<unknown>>();
 function serial<T>(key:string,fn:()=>Promise<T>):Promise<T>{
  if(key.startsWith('board:'))return withBoardLock(bb,key.slice(6),fn);
  const prev=locks.get(key)??Promise.resolve();
  const next=prev.catch(()=>{}).then(fn);
  const tail=next.then(()=>{},()=>{});
  locks.set(key,tail);
  void tail.then(()=>{if(locks.get(key)===tail)locks.delete(key);});
  return next;
 }

 async function names(){return Object.fromEntries(await Promise.all(roster.roles.map(async r=>[r.id,(await opts.cardOf(r.id))?.name??dataText(DEFAULT_LANGUAGE,r.name)])));}
 async function loadBoard(id:string){return (await bb.storage.kv.get<Board>(BOARD_KEY+id))??null;}
 async function saveBoard(b:Board){
  b.updatedAt=now();await bb.storage.kv.set(BOARD_KEY+b.id,b);
  const file=mirrorPath(b.id);
  if(file){try{mkdirSync(mirrorDir!,{recursive:true});writeFileSync(file,boardMarkdown({...b,rows:await live(b)},await names()),'utf8');}catch(e){bb.log?.warn?.('[cyber-office dispatch] зеркало: '+short(e));}}
  try{bb.realtime.publish('board-changed',{boardId:b.id,projectId:b.projectId});}catch{/* нет realtime */}
 }
 async function newBoard(projectId:string,threadId:string,title:string,primary=false):Promise<Board>{
  const at=now();
  const b:Board={id:'b_'+rid(),projectId,title:baseTitle(title),primary,currentThreadId:threadId,shifts:[threadId],shiftStartedAt:{[threadId]:at},rows:[],handoff:null,updatedAt:at};
  await saveBoard(b);return b;
 }
 async function entryOf(threadId:string){if(opts.experimental&&!(await opts.experimental()))throw new Error(dataText(await language(),"Экспериментальные функции выключены"));await ready;const e=entries.get(threadId);if(!e)throw new Error((await locale())('dispatch_inactive'));return e;}
 async function roleId(role:string){const c=await opts.cardOf(role);if(c)return c.id;if(role==='stas'||role==='Стас')return 'stas';throw new Error((await locale())('dispatch_unknown_role',role));}
 const out=(threadId:string,e:DispatchEntry)=>({threadId,board:e.board,config:e.config,predecessor:e.predecessor,shift:e.shift,acceptedAt:e.acceptedAt});
 const turnsOf=async(id:string)=>(await bb.storage.kv.get<number>(TURNS_KEY+id))??0;
 async function requireBoardThread(b:Board,id:string){
  const t=await threadOnBoard(bb,b,id);
  if(!t)throw new Error((await locale())('board_thread_required',id));
  return t;
 }

 async function usageOf(threadId:string){
  try{const c=await bb.sdk.threads.context({threadId});const u=c?.usage;return u?{usedTokens:u.usedTokens??null,window:u.modelContextWindow??null,estimated:!!u.estimated}:null;}
  catch{return null;}
 }
 async function sendTo(threadId:string,text:string){
  await bb.sdk.threads.send({threadId,input:[{type:'text',text}],mode:'queue-if-active'} as Parameters<typeof bb.sdk.threads.send>[0]);
 }

 async function shiftBlockedUntil(b:Board,at:number){
  if(b.shiftBlockedUntil!=null&&b.shiftBlockedUntil>at)return b.shiftBlockedUntil;
  const started=b.shiftStartedAt??={};
  for(const id of b.shifts){
   if(started[id]!=null)continue;
   try{started[id]=(await bb.sdk.threads.get({threadId:id})).createdAt??at;}
   catch{started[id]=at;}
  }
  const recent=b.shifts.map(id=>started[id]).filter(time=>time>at-SHIFT_WINDOW).sort((a,b)=>b-a);
  if(recent.length<SHIFT_LIMIT)return null;
  b.shiftBlockedUntil=recent[SHIFT_LIMIT-1]+SHIFT_WINDOW;
  await saveBoard(b);
  return b.shiftBlockedUntil;
 }

 /** Новая смена: тот же проект, окружение, провайдер, модель и усилие. */
 async function spawnSuccessor(oldId:string,note:string,usage?:number|null){
  const e=await entryOf(oldId);
  return serial('board:'+e.board,async()=>{
   const tr=await locale();
   const b=await loadBoard(e.board);if(!b)throw new Error(tr('board_unavailable',e.board));
   const st=await bb.storage.kv.get<ShiftState>(SHIFT_KEY+oldId);
   if(st?.successor)return {id:st.successor,existing:true};
   if(b.handoff?.from===oldId&&b.handoff.to)return {id:b.handoff.to,existing:true};
   if(e.acceptedAt==null)throw new Error(tr('shift_accept_first'));
   if(b.currentThreadId!==oldId)throw new Error(tr('shift_current_required'));
   const turns=await turnsOf(oldId);
   if(turns<e.config.minTurns)throw new Error(tr('shift_min_turns',turns,e.config.minTurns));
   if(await shiftBlockedUntil(b,now())){
    if(st?.state==='asked')await bb.storage.kv.delete(SHIFT_KEY+oldId);
    throw new Error(tr('shift_limit',SHIFT_LIMIT));
   }
   const old=await requireBoardThread(b,oldId);
   if(usage===undefined){
    const u=await usageOf(oldId);
    usage=u?.usedTokens!=null&&u.window?u.usedTokens/u.window:null;
   }
   let exec:{model?:string;reasoningLevel?:string}|null=null;
   try{exec=await bb.sdk.threads.defaultExecutionOptions({threadId:oldId});}catch{exec=null;}
   const n=b.shifts.length+1;
   // Заметка, положенная на доску заранее (boardImport), идёт в передачу первой.
   const carried=b.handoff&&!b.handoff.to?b.handoff.note.trim():'';
   const own=note.trim().slice(0,4000);
   const full=carried?[carried,own?tr('shift_handoff_previous')+'\n'+own:''].filter(Boolean).join('\n\n'):own;
   const handoffNote=full.slice(0,10000)||tr('shift_handoff_empty');
   const nonce=rid()+rid();nonces.add(nonce);
   const prompt=[
    tr('reply_user_language'),
    tr('shift_prompt_intro',n,oldId,b.id),
    tr('shift_prompt_board'),
    tr('shift_prompt_accept'),
    '',tr('shift_prompt_data'),quoteLines(handoffNote),
   ].join('\n');
   let t;
   try{
    t=await bb.sdk.threads.spawn({projectId:old.projectId,environment:{type:'reuse',environmentId:old.environmentId},providerId:old.providerId,
     ...(exec?.model?{model:exec.model}:{}),...(exec?.reasoningLevel?{reasoningLevel:exec.reasoningLevel}:{}),
     title:`${baseTitle(old.title)} · shift ${n}`,prompt,pinned:old.pinnedAt!=null,...(old.sectionId?{sectionId:old.sectionId}:{}),
     pluginMetadata:{dispatcher:{board:b.id,nonce,predecessor:oldId}}} as Parameters<typeof bb.sdk.threads.spawn>[0]);
    const at=now();
    b.handoff={from:oldId,to:t.id,note:handoffNote,at,usage};
    b.shifts.push(t.id);b.shiftStartedAt![t.id]=at;delete b.shiftBlockedUntil;
    await saveBoard(b);
    entries.set(t.id,{board:b.id,config:{...e.config,minTurns:Math.max(e.config.minTurns,DEFAULT_DISPATCH.minTurns)},predecessor:oldId,shift:n,acceptedAt:null});await saveEntries();
    await bb.storage.kv.set(SHIFT_KEY+oldId,{...(st??{at,why:tr('shift_manual_request'),usage}),state:'spawned',successor:t.id,note:handoffNote} satisfies ShiftState);
   }finally{nonces.delete(nonce);}
   await bb.storage.kv.set('role:'+t.id,'stas');
   await logShiftPass(bb,b,now());
   try{bb.realtime.publish('threads-changed',null);}catch{/* нет realtime */}
   return {id:t.id,existing:false};
  });
 }

 /** Архив старой смены: только по точному id, только если архив никого больше не заденет. */
 async function archiveOld(b:Board,oldId:string,newId:string){
  const st=await bb.storage.kv.get<ShiftState>(SHIFT_KEY+oldId);
  if(!st||st.successor!==newId)throw new Error(`The previous shift ${oldId} did not hand off the board to ${newId}`);
  await requireBoardThread(b,oldId);
  await requireBoardThread(b,newId);
  const refuseArchive=async()=>{
   const error=(await locale())('shift_archive_outside_board');
   await bb.storage.kv.set(SHIFT_KEY+oldId,{...st,state:'failed',error});
   return error;
  };
  // Исполнители старой смены переходят к новой, иначе архив родителя унёс бы их с собой.
  const children=[];
  for(let offset=0;;offset+=200){
   if(offset>=5000)return refuseArchive();
   const kids=await bb.sdk.threads.list({parentThreadId:oldId,archived:false,includeHidden:true,limit:200,offset});
   for(const k of kids){
    if(k.projectId!==b.projectId)return refuseArchive();
    if(k.id!==newId)children.push(k.id);
   }
   if(kids.length<200)break;
  }
  for(const threadId of children)await bb.sdk.threads.update({threadId,parentThreadId:newId});
  const old=await requireBoardThread(b,oldId);
  if(old.archivedAt){await bb.storage.kv.set(SHIFT_KEY+oldId,{...st,state:'archived'});return 'already archived';}
  if(['active','starting','pending'].includes(old.status)){await bb.storage.kv.set(SHIFT_KEY+oldId,{...st,state:'accepted'});return 'previous shift is active and will be archived after its turn';}
  const cascade=await bb.sdk.threads.experimental_listCascade?.({threadIds:[oldId],action:'archive'}).catch(()=>null);
  if(cascade?.threads.find(x=>x.threadId===oldId)?.cascadeThreadIds?.some(id=>id!==oldId))return refuseArchive();
  await bb.sdk.threads.archive({threadId:oldId});
  entries.delete(oldId);await saveEntries();
  await bb.storage.kv.set(SHIFT_KEY+oldId,{...st,state:'archived'});
  return 'archived '+oldId;
 }

 async function accept(newId:string){
  const e=await entryOf(newId);
  const tr=await locale();
  if(!e.predecessor)throw new Error(tr('shift_no_handoff'));
  const oldId=e.predecessor;
  const b=await serial('board:'+e.board,async()=>{
   const b=await loadBoard(e.board);if(!b)throw new Error(tr('board_unavailable',e.board));
   if(b.currentThreadId!==newId){
    if(b.currentThreadId!==oldId||b.handoff?.from!==oldId||b.handoff.to!==newId)throw new Error(tr('shift_no_handoff'));
    await requireBoardThread(b,newId);
    b.currentThreadId=newId;await saveBoard(b);
   }
   if(e.acceptedAt==null){entries.set(newId,{...e,acceptedAt:now()});await saveEntries();}
   if(b.primary)await bb.storage.kv.set(COORD_KEY+b.projectId,newId);
   return b;
  });
  const result=await serial('thr:'+oldId,()=>archiveOld(b,oldId,newId));
  try{bb.realtime.publish('threads-changed',null);}catch{/* нет realtime */}
  return {board:b.id,old:oldId,archive:result,open:b.rows.filter(isOpenRow).length};
 }

 async function live(b:Board,rows=b.rows){
  return Promise.all(rows.map(async (r):Promise<z.infer<typeof rowSchema>>=>{
   if(!r.threadId)return {...r,live:null};
   const t=await threadOnBoard(bb,b,r.threadId);
   const {invalidThread,...row}=r;
   if(!t){
    const {note,...safeRow}=row;
    return {...safeRow,threadId:null,invalidThread:true,live:null};
   }
   return {...row,live:{status:t.status,title:t.title??t.titleFallback??null,pending:!!(t as {hasPendingInteraction?:boolean}).hasPendingInteraction,archived:!!t.archivedAt}};
  }));
 }

 // ---------- инструменты агента ----------
 const boardOfCtx=async(threadId:string)=>{const e=await entryOf(threadId);const b=await loadBoard(e.board);if(!b)throw new Error('Board not found');return {e,b};};
 bb.agents.registerTool({name:'team_board_list',description:'Read the Stas board for tasks, assignees, statuses, and threads.',
  parameters:z.object({all:z.boolean().optional().describe('Include closed tasks when true')}).strict(),
  presentation:{label:{pending:text('dispatch_reading'),completed:text('dispatch_board')}},
  async execute({all},ctx){
   const {b}=await boardOfCtx(ctx.threadId);const rows=await live(b,all?b.rows:b.rows.filter(isOpenRow));const tr=await locale();
   const shiftBlocked=b.shiftBlockedUntil!=null&&b.shiftBlockedUntil>now()?tr('shift_limit',SHIFT_LIMIT):undefined;
   return JSON.stringify({board:b.id,shift:b.shifts.length,handoff:b.handoff??null,shiftBlocked,rows:rows.map(r=>({id:r.id,task:r.task,role:r.roleId,status:r.invalidThread?tr('board_invalid_thread'):BOARD_STATUS_TEXT[r.status],threadId:r.threadId,thread:r.live?`${r.live.status}${r.live.pending?', waiting for the user':''}`:null,note:r.note,updated:new Date(r.updatedAt).toISOString()}))});
  }});
 bb.agents.registerTool({name:'team_board_add',description:'Add a task, assignee role, status, and thread to the board.',
  parameters:z.object({task:z.string().min(1).max(300),role:z.string().min(1).max(40),threadId:z.string().optional(),status:statusEnum.optional(),note:z.string().max(400).optional(),criteria:z.string().max(400).optional()}).strict(),
  presentation:{label:{pending:text('dispatch_adding'),completed:text('dispatch_added')}},
  async execute(p,ctx){
   const {e}=await boardOfCtx(ctx.threadId);const role=await roleId(p.role);
   return serial('board:'+e.board,async()=>{const b=(await loadBoard(e.board))!;const at=now();
    if(p.threadId!==undefined)await requireBoardThread(b,p.threadId);
    const row:BoardRow={id:'r'+(b.rows.length+1),task:p.task,roleId:role,status:p.status??(p.threadId?'working':'todo'),threadId:p.threadId??null,createdAt:at,updatedAt:at,...(p.note?{note:p.note}:{}),...(p.criteria?{criteria:p.criteria}:{})};
    updateRowStatus(row,row.status,at);b.rows.push(row);await saveBoard(b);return JSON.stringify({row:row.id});});
  }});
 bb.agents.registerTool({name:'team_board_update',description:'Update a board row’s status, thread, and note.',
  parameters:z.object({id:z.string().min(1),status:statusEnum.optional(),threadId:z.string().optional(),note:z.string().max(400).optional(),task:z.string().max(300).optional(),role:z.string().max(40).optional(),critic:z.object({verdict:z.enum(['pass','rework']),by:z.string(),at:z.number()}).nullable().optional()}).strict(),
  presentation:{label:{pending:text('dispatch_updating'),completed:text('dispatch_updated')}},
  async execute(p,ctx){
   const {e}=await boardOfCtx(ctx.threadId);const role=p.role?await roleId(p.role):undefined;
   return serial('board:'+e.board,async()=>{const b=(await loadBoard(e.board))!;const row=b.rows.find(r=>r.id===p.id);if(!row)throw new Error('Board row not found: '+p.id);
    if(p.threadId!==undefined){
     await requireBoardThread(b,p.threadId);
     if(row.threadId&&row.threadId!==p.threadId&&!await threadOnBoard(bb,b,row.threadId))delete row.note;
     row.threadId=p.threadId;delete row.invalidThread;
    }
    const previousStatus=row.status;
    updateRowStatus(row,p.status??row.status,now(),p.critic);if(p.note!==undefined)row.note=p.note;if(p.task)row.task=p.task;if(role)row.roleId=role;
    await saveBoard(b);await logStatusPass(bb,b.id,row,previousStatus);return JSON.stringify({row:row.id,status:BOARD_STATUS_TEXT[row.status]});});
  }});
 bb.agents.registerTool({name:'team_dispatch',description:'Assign work in a new child thread using the role’s execution settings and add a board row.',
  parameters:z.object({role:z.string().min(1).max(40).describe('Role ID or name, for example nora or bolt'),title:z.string().min(1).max(120).describe('Thread title. The plugin adds the role prefix.'),brief:z.string().min(1).max(8000).describe('Goal, files, constraints, acceptance criteria, and required evidence'),criteria:z.string().max(400).optional()}).strict(),
  presentation:{label:{pending:text('dispatch_assigning'),completed:text('dispatch_assigned')}},
  async execute(p,ctx){
   const {e}=await boardOfCtx(ctx.threadId);
   const card=await opts.cardOf(p.role);if(!card||card.id==='stas')throw new Error('Select an assignee role: '+p.role);
   return serial('dispatch:'+ctx.threadId,()=>serial('board:'+e.board,async()=>{
    const b=await loadBoard(e.board);const tr=await locale();if(!b)throw new Error(tr('board_unavailable',e.board));
    const recentKey=DISPATCH_HISTORY_KEY+ctx.threadId;
    const cutoff=now()-DISPATCH_WINDOW;
    const recent=((await bb.storage.kv.get<number[]>(recentKey))??[]).filter(at=>at>cutoff);
    if(recent.length>=DISPATCH_LIMIT)throw new Error(tr('dispatch_rate_limit',DISPATCH_LIMIT));
    if(b.rows.filter(isOpenRow).length>=OPEN_ROW_LIMIT)throw new Error(tr('dispatch_row_limit',OPEN_ROW_LIMIT));
    const parent=await requireBoardThread(b,ctx.threadId);
    const ex=e.config.childExecution??await roleExecution(bb,parent.projectId,card.brains,card.providerAvailable)??{providerId:parent.providerId,model:'',reasoningLevel:''};
    const title=`[${card.name}] ${p.title.replace(/^\[[^\]]+\]\s*/,'')}`;
    const prompt=`Reply in the user's language\n\nYou are ${card.name} (${card.role}). Stas assigned this task and receives the result.\n\n${p.brief}${p.criteria?`\n\nAcceptance criteria: ${p.criteria}`:''}${DESIGN_ROLES.has(card.id)?'\n\n'+DESIGN_RULES:''}`;
    const t=await bb.sdk.threads.spawn({projectId:parent.projectId,environment:{type:'reuse',environmentId:parent.environmentId},providerId:ex.providerId,...(ex.model?{model:ex.model}:{}),...(ex.reasoningLevel?{reasoningLevel:ex.reasoningLevel}:{}),
     parentThreadId:ctx.threadId,title,prompt} as Parameters<typeof bb.sdk.threads.spawn>[0]);
    const at=now();
    await bb.storage.kv.set(recentKey,[...recent,at]);
    const row:BoardRow={id:'r'+(b.rows.length+1),task:p.title,roleId:card.id,status:'working',threadId:t.id,createdAt:at,updatedAt:at,...(p.criteria?{criteria:p.criteria}:{})};
    b.rows.push(row);await saveBoard(b);
    await bb.storage.kv.set('role:'+t.id,card.id);
    try{bb.realtime.publish('roles-changed',{threadId:t.id});}catch{/* нет realtime */}
    return JSON.stringify({threadId:t.id,row:row.id,who:card.name,model:ex.model||'default',directive:await logDispatchPass(bb,e.board,card.id,p.title,t.id,ctx.threadId,at)});
   }));
  }});
 bb.agents.registerTool({name:'team_handoff',description:'Record a handoff of up to 15 lines and start a successor coordinator thread. End the turn after calling.',
  parameters:z.object({note:z.string().min(1).max(4000)}).strict(),
  presentation:{label:{pending:text('dispatch_handing_off'),completed:text('dispatch_handed_off')}},
  async execute({note},ctx){
   await entryOf(ctx.threadId);
   return serial('thr:'+ctx.threadId,async()=>{
    const {id,existing}=await spawnSuccessor(ctx.threadId,note);
    return JSON.stringify({successor:id,note:(await locale())(existing?'shift_successor_exists':'shift_handoff_recorded')});
   });
  }});
 bb.agents.registerTool({name:'team_shift_accept',description:'Accept the board for the new shift and archive the exact predecessor thread.',
  parameters:z.object({}).strict(),
  presentation:{label:{pending:text('dispatch_accepting'),completed:text('dispatch_accepted')}},
  async execute(_p,ctx){return JSON.stringify(await accept(ctx.threadId));}});

 // ---------- смена караула по событию «тред закончил ход» ----------
 const ASK=(why:string)=>`[Cyber Office] Shift handoff: ${why}. Call team_handoff with up to 15 lines on current work, assignees, items waiting for the user, decisions, and agreements. If the tool is unavailable, reply with the handoff text. Then end your turn.`;
 async function onIdle(threadId:string,lastText:string|null){
  if(opts.experimental&&!(await opts.experimental()))return;
  await ready;const e=entries.get(threadId);if(!e)return;
  const turns=(await turnsOf(threadId))+1;await bb.storage.kv.set(TURNS_KEY+threadId,turns);
  const st=await bb.storage.kv.get<ShiftState>(SHIFT_KEY+threadId);
  if(st?.state==='accepted'&&st.successor){
   const b=await loadBoard(e.board);if(b)await archiveOld(b,threadId,st.successor);
   return;
  }
  if(st?.state==='asked'&&!st.successor){await spawnSuccessor(threadId,lastText??'',st.usage);return;}
  if(st)return;
  // Новая смена, которая ответила «принял смену», но инструмент не вызвала.
  if(e.acceptedAt==null){if(e.predecessor&&/принял[аи]?\s+смену/i.test(lastText??''))await accept(threadId);return;}
  const thread=await bb.sdk.threads.get({threadId});
  if((thread as {hasPendingInteraction?:boolean}).hasPendingInteraction||(thread.queuedMessageCount??0)>0||thread.archivedAt)return;
  const u=await usageOf(threadId);
  const d=shiftDue(u?{usedTokens:u.usedTokens,window:u.window}:null,turns,e.config);
  if(!d.due)return;
  await serial('board:'+e.board,async()=>{
   const b=await loadBoard(e.board);if(!b||b.currentThreadId!==threadId||!await threadOnBoard(bb,b,threadId))return;
   const at=now();if(await shiftBlockedUntil(b,at))return;
   await bb.storage.kv.set(SHIFT_KEY+threadId,{state:'asked',at,why:d.why,usage:d.ratio} satisfies ShiftState);
   await sendTo(threadId,ASK(d.why));
  });
 }
 bb.events.on('thread.idle',async({thread,lastAssistantText})=>{
  if(!entries.has(thread.id))return;
  try{await serial('thr:'+thread.id,()=>onIdle(thread.id,lastAssistantText));}
  catch(err){bb.log?.warn?.('[cyber-office dispatch] смена '+thread.id+': '+short(err));
   try{const st=await bb.storage.kv.get<ShiftState>(SHIFT_KEY+thread.id);if(st&&st.state!=='archived')await bb.storage.kv.set(SHIFT_KEY+thread.id,{...st,error:short(err)});}catch{/* kv недоступен */}}
 });

 // ---------- RPC ----------
 const handlers:Handlers={
  async getBoards({projectId}){
   const keys=await bb.storage.kv.list(BOARD_KEY);const boards=[];
   for(const k of keys){const b=await bb.storage.kv.get<Board>(k);if(!b||b.projectId!==projectId)continue;
    // Доска выключенного и архивного Стаса (старая песочница) в офис не идёт.
    const e=entries.get(b.currentThreadId);
    if(!e){try{const cur=await bb.sdk.threads.get({threadId:b.currentThreadId});if(cur.archivedAt)continue;}catch{continue;}}
    const {shiftBlockedUntil,...board}=b;
    boards.push({...board,rows:await live(b),...(shiftBlockedUntil!=null&&shiftBlockedUntil>now()?{shiftBlockedUntil}:{}),...(e?{config:{handoffAt:e.config.handoffAt,handoffTurns:e.config.handoffTurns}}:{}),mirror:mirrorPath(b.id)});}
   boards.sort((a,b)=>Number(b.primary)-Number(a.primary)||b.updatedAt-a.updatedAt);
   return {boards};
  },
  async dispatcherStart(p){
   await ready;if(TEST_TITLE.test(p.title))throw new Error((await locale())('test_thread_excluded'));
   const config=mergeConfig(DEFAULT_DISPATCH,p.config);
   const nonce=rid()+rid();nonces.add(nonce);
   const boardId='b_'+rid();
   let t;
   try{
    t=await bb.sdk.threads.spawn({projectId:p.projectId,environment:{type:'reuse',environmentId:p.environmentId},providerId:p.providerId,model:p.model,reasoningLevel:p.reasoningLevel,title:p.title,prompt:p.prompt,
     pluginMetadata:{dispatcher:{board:boardId,nonce}}} as Parameters<typeof bb.sdk.threads.spawn>[0]);
    entries.set(t.id,{board:boardId,config,predecessor:null,shift:1,acceptedAt:now()});await saveEntries();
   }finally{nonces.delete(nonce);}
   await bb.storage.kv.set('role:'+t.id,'stas');
   const at=now();await saveBoard({id:boardId,projectId:p.projectId,title:baseTitle(p.title),primary:false,currentThreadId:t.id,shifts:[t.id],shiftStartedAt:{[t.id]:at},rows:[],handoff:null,updatedAt:at});
   return out(t.id,entries.get(t.id)!);
  },
  async dispatcherEnable({threadId,config,confirmCoordinator}){
   await ready;const t=await bb.sdk.threads.get({threadId});
   if(TEST_TITLE.test(t.title??''))throw new Error((await locale())('test_thread_excluded'));
   const isCoord=Object.values(COORDINATORS).includes(threadId)||(!t.parentThreadId&&t.pinnedAt!=null)||confirmCoordinator===threadId;
   if(isCoord&&confirmCoordinator!==threadId)throw new Error((await locale())("coordinator_confirmation",threadId));
   const prev=entries.get(threadId);
   const e:DispatchEntry=prev?{...prev,config:mergeConfig(prev.config,config)}:{board:(await newBoard(t.projectId,threadId,t.title??(await opts.cardOf('stas'))?.name??'Stas',isCoord)).id,config:mergeConfig(DEFAULT_DISPATCH,config),predecessor:null,shift:1,acceptedAt:now()};
   entries.set(threadId,e);await saveEntries();
   return {...out(threadId,e),note:(await locale())(prev?'dispatch_thresholds':'dispatch_enabled')};
  },
  async boardImport({boardId,rows,carry}){
   await ready;
   const roles=await Promise.all(rows.map(r=>roleId(r.role)));
   return serial('board:'+boardId,async()=>{
    const b=await loadBoard(boardId);if(!b)throw new Error((await locale())('board_unavailable',boardId));
    const open=new Set(b.rows.filter(r=>r.status!=='done'&&r.status!=='dropped').map(r=>r.task.trim()));
    const added:string[]=[];let skipped=0;const at=now();
    rows.forEach((p,i)=>{
     if(open.has(p.task.trim())){skipped++;return;}
     const row:BoardRow={id:'r'+(b.rows.length+1),task:p.task,roleId:roles[i],status:p.status??(p.threadId?'working':'todo'),threadId:p.threadId??null,createdAt:at,updatedAt:at,...(p.note?{note:p.note}:{})};
     updateRowStatus(row,row.status,at);b.rows.push(row);open.add(p.task.trim());added.push(row.id);
    });
    if(carry?.trim())b.handoff={from:b.currentThreadId,to:null,note:carry.trim(),at,usage:null};
    await saveBoard(b);
    return {board:b.id,added,skipped,open:b.rows.filter(r=>r.status!=='done'&&r.status!=='dropped').length,carry:!!b.handoff&&!b.handoff.to};
   });
  },
  async dispatcherDisable({threadId}){await ready;const had=entries.delete(threadId);if(had)await saveEntries();return {threadId,disabled:had};},
  async dispatcherStatus({threadId}){
   await ready;const e=entries.get(threadId)??null;
   const turns=await turnsOf(threadId);
   const usage=await usageOf(threadId);
   const shift=(await bb.storage.kv.get<ShiftState>(SHIFT_KEY+threadId))??null;
   const b=e?await loadBoard(e.board):null;
   const due=shiftDue(usage,turns,e?.config??DEFAULT_DISPATCH);
   if(b?.currentThreadId===threadId&&b.shiftBlockedUntil!=null&&b.shiftBlockedUntil>now()){
    const why=(await locale())('shift_limit',SHIFT_LIMIT);
    return {entry:out(threadId,e!),turns,usage,shift:{state:'blocked',why,until:b.shiftBlockedUntil},due:{...due,due:false,why}};
   }
   return {entry:e?out(threadId,e):null,turns,usage,shift,due};
  },
 };

 return {
  saveBoard,
  handlers,
  /** Для bb.agents.configure: инструменты и правила только тредам со схемой. */
  selection(ctx:{thread:{id:string};pluginMetadata:Record<string,unknown>}):{tools:string[];instructions:string|null}{
   const meta=ctx.pluginMetadata?.dispatcher as {nonce?:unknown}|undefined;
   const on=entries.has(ctx.thread.id)||(typeof meta?.nonce==='string'&&nonces.has(meta.nonce));
   return on?{tools:[...DISPATCH_TOOLS],instructions:DISPATCHER_RULES}:{tools:[],instructions:null};
  },
  /** Сменённый координатор проекта, если настоящий Стас уже передал смену. */
  async coordinatorOverride(projectId:string){return (await bb.storage.kv.get<string>(COORD_KEY+projectId))??null;},
  ready,
 };
}
