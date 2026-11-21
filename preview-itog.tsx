// Офлайн-превью карточки «Итог»: node scripts/build-preview-itog.mjs, затем preview-itog.html.
// Параметры: ?theme=dark|light, ?w=900 (ширина колонки чата), ?case=<id> (одна карточка).
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OfficeLanguage,useText} from './i18n-ui';
import {languageOf,translator} from './i18n.ts';
import {judgeItog,parseItog} from './itog';
import {ItogCard,type ItogTheme} from './itog-card';
import './itog.css';

const CASES = [
 {id:'ask',title:'result_preview_ask_title',code:'result_preview_ask_source'},
 {id:'done',title:'result_preview_done_title',code:'result_preview_done_source'},
 {id:'part',title:'result_preview_part_title',code:'result_preview_part_source'},
 {id:'block',title:'result_preview_block_title',code:'result_preview_block_source'},
 {id:'work',title:'result_preview_work_title',code:'result_preview_work_source'},
 {id:'weak',title:'result_preview_weak_title',code:'result_preview_weak_source'},
 {id:'long',title:'result_preview_long_title',code:'result_preview_long_source'},
 {id:'stream',title:'result_preview_stream_title',code:'result_preview_stream_source'},
 {id:'broken',title:'result_preview_broken_title',code:'result_preview_broken_source'},
] as const;


const q=new URLSearchParams(location.search);
const language=languageOf(q.get('lang'));
const theme:ItogTheme=q.get('theme')==='light'?'light':'dark';
const width=Number(q.get('w'))||1440;
const only=q.get('case');

function Original({code}:{code:string}){return <pre className="kmi-mock-original"><span>itog</span>{'\n'+code}</pre>;}

function Case({c,onSend}:{c:typeof CASES[number];onSend:(t:string)=>Promise<'sent'>}){
 const tr=useText();
 const [n,setN]=useState(0);const streamLines=tr(CASES[0].code).split('\n');
 useEffect(()=>{if(c.id!=='stream')return;const t=setInterval(()=>setN(x=>(x+1)%(streamLines.length*4+8)),220);return()=>clearInterval(t);},[c.id,streamLines.length]);
 // Стриминг по полстроки: видно, как поля появляются и недописанная строка не липнет к прошлой.
 let code=tr(c.code),streaming=false;
 if(c.id==='stream'){const fixed=q.get('frame');const k=fixed?Number(fixed):n;const full=Math.floor(k/2);const half=k%2;
  const lines=streamLines.slice(0,full);if(half&&streamLines[full])lines.push(streamLines[full].slice(0,Math.ceil(streamLines[full].length/2)));
  code=lines.join('\n');streaming=full<streamLines.length;}
 const itog=parseItog(code,{streaming});const verdict=judgeItog(itog);
 return <figure className="pv-case" data-case={c.id}>
  <figcaption>{tr(c.title)}</figcaption>
  {!streaming&&verdict.level==='broken'?<Original code={code}/>:
   <ItogCard itog={itog} verdict={verdict} streaming={streaming} theme={theme} onSend={onSend} onCopyPath={()=>true} original={<Original code={code}/>}/>}
 </figure>;
}

function App(){
 const tr=useText();
 const [draft,setDraft]=useState('');
 // Имитация отправки в тред: ответ появляется в журнале ниже через 300 мс.
 const onSend=async(t:string)=>{await new Promise(r=>setTimeout(r,300));setDraft(d=>(d?d.replace(/\n*$/,'\n'):'')+t);return 'sent' as const;};
 const list=only?CASES.filter(c=>c.id===only):CASES;
 return <main className="pv" data-theme={theme} style={{maxWidth:width}}>
  <header className="pv-head"><h1>{tr("result_preview_heading")}</h1><p>{tr("result_preview_caption",width)}</p></header>
  <div className="pv-grid">{list.map(c=><Case key={c.id} c={c} onSend={onSend}/>)}</div>
  <label className="pv-composer"><span>{tr("result_preview_sent")}</span><textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={3} placeholder={tr("result_preview_empty")}/></label>
 </main>;
}
createRoot(document.getElementById('root')!).render(<OfficeLanguage.Provider value={language}><App/></OfficeLanguage.Provider>);
document.documentElement.lang=language;
document.title=translator(language)('result_preview_heading');
