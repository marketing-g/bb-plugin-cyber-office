// Разбор блока ```itog``` из ответа агента. Без зависимостей: его берут и карточка, и тесты.
// English and Russian input share the same internal fields.
import {DEFAULT_LANGUAGE, dataText, translator, type Language} from './i18n.ts';
import {isAbsoluteLocalPath,isNetworkPath,WINDOWS_DRIVE_PATH} from './local-path.ts';

export type ItogStatus='готово'|'частично'|'вопрос'|'блокер'|'работаю';
export const ITOG_STATUSES:readonly ItogStatus[]=['готово','частично','вопрос','блокер','работаю'];
export interface ItogAsk{text:string;options:string[]}
export interface Itog{
 status:ItogStatus|null;
 /** Как агент написал статус, если он не из словаря. Пусто, если статуса нет. */
 rawStatus:string;
 summary:string;
 asks:ItogAsk[];
 /** Агент прямо написал «от вас: нет». */
 noAsks:boolean;
 files:string[];
 proof:string;
 next:string;
 extra:{key:string;value:string}[];
 /** Какие поля встретились в блоке (канонические ключи), чтобы отличать «нет поля» от «пусто». */
 fields:ItogField[];
}
export type ItogField='статус'|'итог'|'от вас'|'файлы'|'проверено'|'дальше';

const KEY_ALIASES:Record<string,ItogField>={
 'статус':'статус','status':'статус',
 'итог':'итог','итоги':'итог','summary':'итог','result':'итог',
 'от вас':'от вас','нужно от вас':'от вас','needs you':'от вас',
 'файлы':'файлы','файл':'файлы','files':'файлы',
 'проверено':'проверено','проверка':'проверено','checked':'проверено',
 'дальше':'дальше','далее':'дальше','следующий шаг':'дальше','next':'дальше',
};
const STATUS_ALIASES:Record<string,ItogStatus>={
 'готово':'готово','готов':'готово','готова':'готово','сделано':'готово','done':'готово',
 'частично':'частично','partial':'частично',
 'вопрос':'вопрос','вопросы':'вопрос','question':'вопрос',
 'блокер':'блокер','блок':'блокер','заблокировано':'блокер','blocker':'блокер',
 'работаю':'работаю','в работе':'работаю','working':'работаю',
};
const NONE=/^(нет|ничего|не нужно|ничего не нужно|nothing|nothing needed|none|-|—)$/i;
const BULLET=/^\s*(?:[-*•]|\d+[.)])\s+/;
// «ключ: значение»; ключ из букв и пробелов, от двух знаков, чтобы не ловить «D:\…» и «https://…».
const KEY_LINE=/^\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё ]{1,30}?)\s*:\s*(.*)$/;

function clean(s:string){return s.replace(/\s+/g,' ').trim();}
function stripTicks(s:string){const t=s.trim();return t.length>1&&t.startsWith('`')&&t.endsWith('`')?t.slice(1,-1).trim():t;}
function statusOf(raw:string):ItogStatus|null{const k=clean(raw).toLowerCase().replace(/[.!«»"]/g,'');return Object.hasOwn(STATUS_ALIASES,k)?STATUS_ALIASES[k]:null;}
export function parseAsk(line:string):ItogAsk{
 const parts=line.split(/\s*\|\s*/).map(clean);
 const text=parts[0]??'';const options:string[]=[];
 for(const o of parts.slice(1))if(o&&!options.includes(o))options.push(o);
 return {text,options};
}

/**
 * Разбирает тело блока. null значит «это не итог» (ни одного известного ключа): рисовать Original.
 * Работает и на недописанном блоке во время стриминга: последняя строка может быть оборвана.
 */
export function parseItog(code:string,opts:{streaming?:boolean}={}):Itog|null{
 const out:Itog={status:null,rawStatus:'',summary:'',asks:[],noAsks:false,files:[],proof:'',next:'',extra:[],fields:[]};
 type Slot={field:ItogField|null;extra:number|null};
 let cur:Slot={field:null,extra:null};
 const text:Partial<Record<ItogField,string[]>>={};
 const push=(f:ItogField,v:string)=>{(text[f]??=[]).push(v);};
 const lines=code.replace(/\r\n?/g,'\n').split('\n');
 // Во время стриминга недописанная строка без двоеточия («от Ста») прилипла бы к прошлому полю: ждём её конца.
 if(opts.streaming&&lines.length>1){const last=lines[lines.length-1];if(last.trim()&&!BULLET.test(last)&&!KEY_LINE.test(last))lines.pop();}
 for(const rawLine of lines){
  const line=rawLine.replace(/\s+$/,'');if(!line.trim())continue;
  const bullet=BULLET.test(line);
  const m=bullet?null:KEY_LINE.exec(line);
  const field=m?Object.hasOwn(KEY_ALIASES,clean(m[1]).toLowerCase())?KEY_ALIASES[clean(m[1]).toLowerCase()]:undefined:undefined;
  if(m&&field){
   cur={field,extra:null};if(!out.fields.includes(field))out.fields.push(field);
   const v=m[2].trim();
   if(field==='статус'){out.rawStatus=clean(v);out.status=statusOf(v);continue;}
   if(v)push(field,v);
   continue;
  }
  if(m&&!m[2].startsWith('//')&&!bullet){
   out.extra.push({key:clean(m[1]),value:m[2].trim()});cur={field:null,extra:out.extra.length-1};continue;
  }
  const item=bullet?line.replace(BULLET,''):line.trim();
  if(cur.field&&cur.field!=='статус'){push(cur.field,(bullet?'\u0000':'')+item);continue;}
  if(cur.extra!==null){const e=out.extra[cur.extra];e.value=e.value?e.value+'\n'+item:item;continue;}
 }
 if(!out.fields.length)return null;
 // Поля-строки: продолжения склеиваем пробелом, пункты списка с новой строки.
 const joined=(f:ItogField)=>(text[f]??[]).map(s=>s.replace('\u0000','')).map(clean).filter(Boolean).join(' ');
 out.summary=joined('итог');out.proof=joined('проверено');out.next=joined('дальше');
 // Списки: каждый пункт отдельно; строка без маркера продолжает предыдущий пункт.
 const items=(f:ItogField)=>{const acc:string[]=[];for(const s of text[f]??[]){if(s.startsWith('\u0000')||!acc.length)acc.push(s.replace('\u0000',''));else acc[acc.length-1]+=' '+s;}return acc.map(clean).filter(Boolean);};
 const asks=items('от вас');
 if(asks.length===1&&NONE.test(asks[0]))out.noAsks=true;
 else out.asks=asks.filter(a=>!NONE.test(a)).map(parseAsk).filter(a=>a.text||a.options.length);
 out.files=items('файлы').map(stripTicks).filter(Boolean);
 return out;
}

/** Ответ, который кнопка варианта вставляет в поле ввода. */
export function answerText(ask:ItogAsk,option?:string){
 const q=ask.text.replace(/[?:.\s]+$/,'');
 if(option===undefined)return q?q+': ':'';
 return q?`${q}: ${option}`:option;
}

// Итог про процесс, а не результат: «работаю», «смотрю», «в процессе».
const PROCESS=/^(работаю|в работе|в процессе|делаю|занимаюсь|начал[аи]?|продолжаю|смотрю|изучаю|разбираюсь|жду|пока ничего|скоро будет|working on|in progress|looking into|checking|waiting)(\b|[\s.,!…]|$)/i;
export type ItogProblem='не итог'|'нет итога'|'итог про процесс'|'нет статуса'|'статус не из словаря'|'нет поля «от вас»'|'вопрос без вопроса';
export interface ItogVerdict{
 /** ok: рисуем карточку; weak: карточку с пометкой; broken: исходный текст (Original). */
 level:'ok'|'weak'|'broken';
 problems:ItogProblem[];
}
/**
 * Оценка итога. Пустой итог или итог «работаю» плохие: пустой рисуем исходным текстом,
 * «работаю» карточкой с пометкой, чтобы вы видел, что результата нет.
 */
export function judgeItog(it:Itog|null):ItogVerdict{
 if(!it)return {level:'broken',problems:['не итог']};
 const p:ItogProblem[]=[];
 const summary=it.summary.trim();
 if(!summary)p.push('нет итога');
 else if(PROCESS.test(summary)||/^working[.!…]*$/i.test(summary)||summary.length<4)p.push('итог про процесс');
 if(!it.fields.includes('статус')||!it.rawStatus)p.push('нет статуса');
 else if(!it.status)p.push('статус не из словаря');
 if(!it.fields.includes('от вас'))p.push('нет поля «от вас»');
 else if(it.status==='вопрос'&&!it.asks.length)p.push('вопрос без вопроса');
 if(p.includes('нет итога'))return {level:'broken',problems:p};
 return {level:p.length?'weak':'ok',problems:p};
}
export function isBadItog(it:Itog|null){return judgeItog(it).level!=='ok';}


/** Где открыть путь из итога: файл на машине треда (абсолютный) или в рабочей папке треда (относительный). */
export type ItogFileTarget=
 {kind:'host';hostId:string;path:string}|
 {kind:'workspace';environmentId:string;path:string};
export interface ItogFileContext{hostId?:string|null;environmentId?:string|null;/** Корень рабочей папки треда, абсолютный. */root?:string|null}
export interface ItogFileLink{target:ItogFileTarget|null;line:number|null;folder:boolean;why:string}
export {isAbsoluteLocalPath as isAbsolutePath} from './local-path.ts';
const SYSTEM_FILE_EXTENSIONS=new Set(['md','txt','csv','json','pdf','png','jpg','jpeg','webp','gif','docx','xlsx','pptx']);

export function canOpenItogFile(link:ItogFileLink){
 const path=link.target?.path;
 if(!path||link.folder||isNetworkPath(path))return false;
 const local=WINDOWS_DRIVE_PATH.test(path)?path.slice(2):path;
 if(/[:\u0000-\u001f]/.test(local))return false;
 const extension=/\.([a-z0-9]+)$/i.exec(local)?.[1];
 return extension!=null&&SYSTEM_FILE_EXTENSIONS.has(extension.toLowerCase());
}
/** Склеивает сегменты, убирает «.» и «..». null, если «..» выходит за корень. */
function normalize(parts:string[]):string[]|null{const out:string[]=[];for(const s of parts){if(!s||s==='.')continue;if(s==='..'){if(!out.length)return null;out.pop();}else out.push(s);}return out;}
const BS='\\';
/**
 * Разбирает путь из блока «файлы»: снимает кавычки, подпись и хвост «:строка», решает, чем открывать.
 * Абсолютный путь внутри рабочей папки треда открывается как файл рабочей папки (превью с git),
 * остальные абсолютные как файл машины треда. Относительный считается от рабочей папки треда.
 */
export function itogFileLink(raw:string,ctx:ItogFileContext={},lang=DEFAULT_LANGUAGE):ItogFileLink{
 const local=(message:string)=>dataText(lang,message);
 let p=stripTicks(raw).replace(/^["'«]+|["'»]+$/g,'').trim();
 // Подпись после файла: «/project/example.md (новый)», «docs/x.md - черновик» (и с тире \u2013, \u2014).
 const cap=/^(.*\.[A-Za-z0-9]{1,8})\s+(?:\(.*\)|[\u2013\u2014-]\s.*)$/.exec(p);if(cap)p=cap[1];
 let line:number|null=null;
 const lm=/^(.*\S):(\d+)(?::\d+)?$/.exec(p);if(lm&&!/^[A-Za-z]$/.test(lm[1])){p=lm[1];line=Number(lm[2]);}
 const folder=/[\\/]$/.test(p);
 if(!p)return {target:null,line,folder,why:local('Пустой путь')};
 if(/^[a-z][a-z0-9+.-]*:\/\//i.test(p))return {target:null,line,folder,why:local('Это ссылка, а не файл')};
 if(isNetworkPath(p)||(!isAbsoluteLocalPath(p)&&ctx.root&&isNetworkPath(ctx.root)))return {target:null,line,folder,why:translator(lang)('file_network_path')};
 if(isAbsoluteLocalPath(p)){
  const drive=WINDOWS_DRIVE_PATH.test(p),win=drive;
  const sep=win?BS:'/';
  const head=drive?p.slice(0,2).toUpperCase()+BS:'/';
  const segs=normalize(p.slice(drive?3:1).split(/[\\/]+/));
  if(!segs)return {target:null,line,folder,why:local('Путь выходит за корень диска')};
  const abs=head+segs.join(sep);
  const root=ctx.root?ctx.root.replace(/[\\/]+$/,''):'';
  if(root&&ctx.environmentId){
   const key=(s:string)=>win?s.replace(/\//g,BS).toLowerCase():s;
   if(key(abs).startsWith(key(root)+sep)){
    const rel=abs.slice(root.length+1).split(/[\\/]+/).join('/');
    return {target:{kind:'workspace',environmentId:ctx.environmentId,path:rel},line,folder,why:local('Открыть файл рабочей папки треда в BB')};
   }
  }
  if(!ctx.hostId)return {target:null,line,folder,why:local('Машина треда не найдена: путь можно только скопировать')};
  return {target:{kind:'host',hostId:ctx.hostId,path:abs},line,folder,why:local('Открыть файл в BB')};
 }
 if(p.startsWith('~'))return {target:null,line,folder,why:local('Путь от домашней папки: откройте по копии')};
 const rel=normalize(p.split(/[\\/]+/));
 if(rel&&rel.length&&ctx.environmentId)return {target:{kind:'workspace',environmentId:ctx.environmentId,path:rel.join('/')},line,folder,why:local('Открыть файл рабочей папки треда в BB')};
 // «..» выше рабочей папки: считаем от её абсолютного корня.
 if(!rel&&ctx.root&&ctx.hostId){
  const base=ctx.root.replace(/[\\/]+$/,'');const win=WINDOWS_DRIVE_PATH.test(ctx.root);
  const r=itogFileLink(base+(win?BS:'/')+p+(line?':'+line:''),{hostId:ctx.hostId},lang);return r;
 }
 return {target:null,line,folder,why:local(ctx.environmentId?'Путь не разобран: можно только скопировать':'У треда нет рабочей папки: относительный путь можно только скопировать')};
}

// ---------- Ответ одним кликом и короткая карточка (v4) ----------

export function plural(n:number,one:string,few:string,many:string){const m10=n%10,m100=n%100;return m10===1&&m100!==11?one:m10>=2&&m10<=4&&(m100<12||m100>14)?few:many;}

/** Ключ ответа: сообщение, номер блока itog в нём, номер пункта «от вас». */
export function itogAnswerKey(messageId:string,fenceIndex:number,askIndex:number){return `${messageId}:${fenceIndex}:${askIndex}`;}

/** Свой ответ: «Вопрос: текст». Пустой текст ничего не отправляет. */
export function freeAnswerText(ask:ItogAsk,text:string){const t=text.trim();return t?answerText(ask,t):'';}

type KV=Pick<Storage,'getItem'|'setItem'>;
/**
 * Что уже отправлено из карточек: в памяти на всю сессию и, если дали хранилище, между перезагрузками.
 * Нужен, чтобы карточка после прокрутки или перерисовки не дала отправить тот же ответ второй раз.
 */
export function createSentLedger(storage?:KV|null,prefix='cyber-office.itog.sent:'){
 const mem=new Map<string,string>();
 return {
  get(key:string):string|null{
   if(mem.has(key))return mem.get(key)!;
   try{const v=storage?.getItem(prefix+key);if(v!=null){mem.set(key,v);return v;}}catch{/* хранилище закрыто */}
   return null;
  },
  mark(key:string,value:string){mem.set(key,value);try{storage?.setItem(prefix+key,value);}catch{/* только в памяти */}},
 };
}
export type SentLedger=ReturnType<typeof createSentLedger>;

export type ItogDetailId='files'|'proof'|'next'|'extra';
/** Свёрнутые части карточки: подпись кнопки и есть ли что раскрывать. Порядок как в карточке. */
export function itogDetails(it:Itog|null,lang:Language=DEFAULT_LANGUAGE):{id:ItogDetailId;label:string}[]{
 if(!it)return [];
 const tr=translator(lang);
 const out:{id:ItogDetailId;label:string}[]=[];
 const n=it.files.length;if(n)out.push({id:'files',label:`${n} ${lang==='ru'?plural(n,tr('file_one'),tr('file_few'),tr('file_many')):tr(n===1?'file_one':'file_many')}`});
 if(it.proof)out.push({id:'proof',label:tr('checked')});
 if(it.next)out.push({id:'next',label:tr('next')});
 const e=it.extra.length;if(e)out.push({id:'extra',label:tr('more_2',e)});
 return out;
}
/** Итог длиннее строки: показываем первую строку и даём раскрыть. */
export function isLongSummary(s:string,limit=110){return s.length>limit;}
