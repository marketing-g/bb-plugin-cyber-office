import {useLanguage,useText} from './i18n-ui';
import type {MessageKey} from './i18n.ts';
// Карточка «Итог»: вид без SDK, чтобы рисоваться и в BB, и в офлайн-превью.
// Обёртка для чата и регистрация слота лежат в itog-app.tsx.
// v4: короткая карточка (итог строкой, вопросы, остальное свёрнуто) и ответ одним кликом.
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {answerText,freeAnswerText,isLongSummary,itogDetails,plural,type Itog,type ItogAsk,type ItogDetailId,type ItogStatus,type ItogVerdict} from './itog';
import {PlainField,type FieldComponent} from './field';

export type ItogTheme='dark'|'light';
type Tone='done'|'part'|'work'|'ask'|'block'|'none';
const TONE:Record<ItogStatus,Tone>={'готово':'done','частично':'part','работаю':'work','вопрос':'ask','блокер':'block'};
const LABEL:Record<ItogStatus,MessageKey>={'готово':"done_2",'частично':"partial",'работаю':"working_3",'вопрос':"needs_an_answer",'блокер':"blocked"};
// Пиксельные значки 5×5 в духе офиса: галка, половина, точки, «!», крест.
const GLYPH:Record<Tone,string[]>={
 done:['....#','...##','#.##.','###..','.#...'],
 part:['#####','#..##','#..##','#..##','#####'],
 work:['.....','.....','#.#.#','.....','.....'],
 ask:['..#..','..#..','..#..','.....','..#..'],
 block:['#...#','.#.#.','..#..','.#.#.','#...#'],
 none:['.....','.....','.....','.....','.....'],
};
function Glyph({tone}:{tone:Tone}){
 const rects:ReactNode[]=[];GLYPH[tone].forEach((row,y)=>[...row].forEach((c,x)=>{if(c==='#')rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1"/>);}));
 return <span className="kmi-glyph" aria-hidden="true"><svg viewBox="-1 -1 7 7" width="14" height="14" shapeRendering="crispEdges">{rects}</svg></span>;
}
/** Как ушёл ответ: сразу в ход или в очередь за идущим ходом. */
export type SendDelivery='sent'|'queued';

export interface ItogCardProps{
 itog:Itog|null;
 verdict:ItogVerdict;
 /** Блок ещё пишется: поля появляются по мере строк, пометки о плохом итоге не показываем, ответы не шлём. */
 streaming:boolean;
 theme:ItogTheme;
 /**
  * Отправить ответ в тред. text уходит агенту, shown остаётся на кнопке как «отправлено».
  * Без него карточка вставляет ответ в поле ввода (onAnswer), как в v3.
  */
 onSend?:(text:string,shown:string,askIndex:number)=>Promise<SendDelivery|void>;
 /** Уже отправленный ответ по номеру пункта: после перерисовки не даём отправить второй раз. */
 sentFor?:(askIndex:number)=>string|null;
 /** Запасной путь без отправки: вставить текст в поле ввода треда. true, если вставлено. */
 onAnswer?:(text:string)=>boolean|void;
 /** Поле «Свой ответ». В BB это поле с микрофоном, в превью обычное. */
 Field?:FieldComponent;
 onCopyPath?:(path:string)=>Promise<boolean>|boolean|void;
 /** Рисует имя файла кнопкой или ссылкой, которая открывает файл. Без него имя просто текст. */
 renderFile?:(path:string,label:ReactNode)=>ReactNode;
 /** Исходный текст блока (в BB это Original), показывается по кнопке. */
 original?:ReactNode;
}

function Ask({ask,n,index,streaming,onSend,sentFor,onAnswer,Field=PlainField}:{ask:ItogAsk;n:number;index:number;streaming:boolean}&Pick<ItogCardProps,'onSend'|'sentFor'|'onAnswer'|'Field'>){
 const tr=useText();
 const [sent,setSent]=useState<string|null>(()=>sentFor?.(index)??null);
 const [busy,setBusy]=useState<string|null>(null);
 const [note,setNote]=useState(()=>sent!==null?tr("sent_to_thread"):'');
 const [free,setFree]=useState(false);const [text,setText]=useState('');const [voice,setVoice]=useState(false);
 const flight=useRef(false);const fieldId=useId();
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const done=sent!==null;
 const send=async(value:string,shown:string)=>{
  if(!value||done||flight.current||streaming)return;
  if(!onSend){
   const ok=onAnswer?.(value);setNote(ok===false?tr("composer_unavailable"):tr("added_to_the_composer_send_it"));
   if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setNote(''),4000);return;
  }
  flight.current=true;setBusy(shown);setNote(tr("sending"));
  try{
   const how=await onSend(value,shown,index);
   setSent(shown);setFree(false);setText('');
   setNote(how==='queued'?tr("queued_until_the_agent_finishes_its"):tr("sent_to_thread"));
  }catch(e){setNote(tr("could_not_send")+String((e as Error)?.message??e));}
  finally{flight.current=false;setBusy(null);}
 };
 const sendFree=()=>{if(voice)return;const t=freeAnswerText(ask,text);if(t)void send(t,text.trim());};
 const lockAll=done||busy!==null||streaming;
 const freeSent=done&&!ask.options.includes(sent!);
 return <li className="kmi-ask" data-sent={done||undefined}>
  <span className="kmi-ask-n" aria-hidden="true">{n}</span>
  <div className="kmi-ask-body">
   <p className="kmi-ask-text">{ask.text||tr("choose_an_option")}</p>
   <div className="kmi-opts" role="group" aria-label={ask.text||tr("options")}>
    {ask.options.map(o=>{const mine=sent===o;return <button key={o} type="button" className={'kmi-opt'+(mine?' is-sent':'')} aria-pressed={mine} disabled={lockAll&&!mine} aria-disabled={mine||undefined}
     onClick={()=>{if(!mine)void send(answerText(ask,o),o);}} title={mine?tr("this_answer_was_already_sent"):tr("send_to_the_thread", o)}>
     {o}{mine&&<span className="kmi-opt-tag">{tr("sent")}</span>}{busy===o&&<span className="kmi-opt-tag">…</span>}
    </button>;})}
    {!done&&<button type="button" className="kmi-opt is-free" aria-expanded={free} aria-controls={fieldId} disabled={busy!==null||streaming} onClick={()=>setFree(f=>!f)}>{tr("your_own_answer")}</button>}
   </div>
   {freeSent&&<p className="kmi-sent-text">{tr("your_answer_2")} {sent}</p>}
   {free&&!done&&<div className="kmi-free" id={fieldId}>
    <Field className="kmi-field" value={text} onValueChange={setText} onVoiceInputActiveChange={setVoice} rows={2} autoFocus
     aria-label={tr("your_answer_to", ask.text||tr('question'))} placeholder={tr("type_or_dictate_an_answer_2")}
     onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendFree();}if(e.key==='Escape'){setFree(false);}}}/>
    <div className="kmi-free-row">
     <button type="button" className="kmi-send" disabled={!text.trim()||voice||busy!==null} onClick={sendFree}>{busy!==null?tr("sending"):voice?tr("recording"):tr("send")}</button>
     <span className="kmi-hint">{tr("ctrl_enter_to_send")}</span>
    </div>
   </div>}
   <p className="kmi-note" role="status" aria-live="polite">{note}</p>
  </div>
 </li>;
}

function FileRow({path,onCopyPath,renderFile}:{path:string;onCopyPath?:ItogCardProps['onCopyPath'];renderFile?:ItogCardProps['renderFile']}){
 const tr=useText();
 const [copied,setCopied]=useState<null|boolean>(null);
 const copy=async()=>{let ok:boolean|void=false;try{ok=await onCopyPath?.(path);}catch{ok=false;}setCopied(ok!==false);setTimeout(()=>setCopied(null),2000);};
 const label=<span className="kmi-file-name">{path}</span>;
 return <li className="kmi-file">
  {renderFile?renderFile(path,label):<span className="kmi-file-text" title={path}>{label}</span>}
  {onCopyPath&&<button type="button" className="kmi-copy" onClick={()=>void copy()} aria-label={tr("copy_path", path)} title={tr("copy_full_path")}>{copied===null?tr("copy_path_2"):copied?tr("copied"):tr("could_not_copy")}</button>}
 </li>;
}

const PROBLEM_TEXT:Partial<Record<string,MessageKey>>={
 'итог про процесс':"describes_progress_without_a_result",
 'нет статуса':"missing_status",
 'статус не из словаря':"unknown_status",
 'нет поля «от вас»':"missing_what_you_need_to_do",
 'вопрос без вопроса':"question_status_with_no_question",
};

export function ItogCard({itog,verdict,streaming,theme,onSend,sentFor,onAnswer,Field,onCopyPath,renderFile,original}:ItogCardProps){
 const tr=useText();
 const lang=useLanguage();
 const [showSource,setShowSource]=useState(false);
 const [open,setOpen]=useState<ReadonlySet<ItogDetailId>>(()=>new Set());
 const [fullSummary,setFullSummary]=useState(false);
 const uid=useId();
 const status=itog?.status??null;
 const tone:Tone=status?TONE[status]:'none';
 const asks=itog?.asks??[];
 const weak=!streaming&&verdict.level==='weak';
 const label=status?tr(LABEL[status]):streaming?tr("writing_result"):itog?.rawStatus||tr("no_status");
 const details=itogDetails(itog,lang);
 const summary=itog?.summary??'';
 const long=!streaming&&isLongSummary(summary);
 const toggle=(id:ItogDetailId)=>setOpen(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const panel=(id:ItogDetailId)=>{
  if(id==='files')return <ul className="kmi-files">{itog!.files.map(f=><FileRow key={f} path={f} onCopyPath={onCopyPath} renderFile={renderFile}/>)}</ul>;
  if(id==='proof')return <p className="kmi-text"><span className="kmi-label">{tr("checked")}</span> {itog!.proof}</p>;
  if(id==='next')return <p className="kmi-text"><span className="kmi-label">{tr("next")}</span> {itog!.next}</p>;
  return <dl className="kmi-rows">{itog!.extra.map((r,i)=><div key={i} className="kmi-row"><dt className="kmi-label">{r.key}</dt><dd>{r.value}</dd></div>)}</dl>;
 };
 return <section className="kmi" data-theme={theme} data-tone={tone} data-streaming={streaming||undefined} data-weak={weak||undefined} aria-label={tr("result", label)}>
  <div className="kmi-card">
   <header className="kmi-head">
    <span className="kmi-status"><Glyph tone={tone}/>{label}</span>
    {streaming&&<span className="kmi-live" aria-hidden="true"><i/><i/><i/></span>}
    <span className="kmi-kind">{tr("result_2")}</span>
   </header>
   {weak&&<p className="kmi-warn" role="note"><b>{tr("incomplete_result")}</b> {verdict.problems.map(p=>PROBLEM_TEXT[p]?tr(PROBLEM_TEXT[p]!):p).join(', ')}</p>}
   <div className="kmi-sum-row">
    <p className={'kmi-summary'+(summary?'':' is-empty')} data-clamp={long&&!fullSummary||undefined} title={long&&!fullSummary?summary:undefined}>{summary||(streaming?tr("the_agent_is_writing_the_result"):tr("the_agent_did_not_include_a"))}</p>
    {long&&<button type="button" className="kmi-more" aria-expanded={fullSummary} onClick={()=>setFullSummary(v=>!v)}>{fullSummary?tr("collapse"):tr("read_more")}</button>}
   </div>
   {asks.length>0&&<div className="kmi-asks">
    <h3 className="kmi-asks-title">{tr("needs_you")} <b>{asks.length}</b><span className="kmi-sr"> {lang==='ru'?plural(asks.length,tr('item_one'),tr('item_few'),tr('item_many')):tr(asks.length===1?'item_one':'item_many')}</span>{onSend&&<small>{tr("selecting_an_option_sends_it_to")}</small>}</h3>
    <ol>{asks.map((a,i)=><Ask key={i+'|'+a.text} ask={a} n={i+1} index={i} streaming={streaming} onSend={onSend} sentFor={sentFor} onAnswer={onAnswer} Field={Field}/>)}</ol>
   </div>}
   {!asks.length&&itog?.noAsks&&<p className="kmi-noasks"><Glyph tone="done"/>{tr("nothing_needed_from_you")}</p>}
   {(details.length>0||(original&&!streaming))&&<div className="kmi-bar">
    {details.map(d=><button key={d.id} type="button" className="kmi-chip" aria-expanded={open.has(d.id)} aria-controls={`${uid}-${d.id}`} onClick={()=>toggle(d.id)}>
     <span className="kmi-caret" aria-hidden="true">{open.has(d.id)?'▾':'▸'}</span>{d.label}</button>)}
    {original&&!streaming&&<button type="button" className="kmi-src" aria-expanded={showSource} onClick={()=>setShowSource(s=>!s)}>{showSource?tr("hide_source"):tr("show_source")}</button>}
   </div>}
   {details.filter(d=>open.has(d.id)).map(d=><div key={d.id} id={`${uid}-${d.id}`} className="kmi-panel" data-panel={d.id}>{panel(d.id)}</div>)}
  </div>
  {showSource&&original&&<div className="kmi-original">{original}</div>}
 </section>;
}
