// Проверка плагина «Cyber Office» после обновления BB. Одна команда из папки плагина:
//   npm run check-after-update
// Делает: типы, тесты, сборку и вызовы health, getTeam, getThreadCard.
// В конце пишет «Всё работает» или «Сломалось» со списком шагов.
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const BB=process.env.BB_CLI??'bb';
const env=process.env;
const PROJECT=env.CYBER_OFFICE_CHECK_PROJECT;
const THREAD=env.CYBER_OFFICE_CHECK_THREAD;
const tmp=mkdtempSync(join(tmpdir(),'cyber-office-check-'));

const results=[];
function run(cmd,args){
 const r=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',shell:process.platform==='win32',timeout:300000});
 return {ok:r.status===0,out:((r.stdout??'')+(r.stderr??'')).trim()};
}
function step(name,fn){
 if(process.stdout.isTTY)process.stdout.write(`… ${name}\r`);
 let ok=false,note='';
 try{const r=fn();ok=r.ok;note=r.note??'';}catch(e){note=String(e?.message??e);}
 results.push({name,ok,note});
 console.log(`${ok?'✓':'✗'} ${name}${note?': '+note:''}`);
 return ok;
}
const tail=s=>s.split(/\r?\n/).filter(Boolean).slice(-6).join('\n    ');
function rpc(method,input){
 const file=join(tmp,method+'.json');writeFileSync(file,JSON.stringify(input));
 const r=run(BB,['plugin','rpc','call','cyber-office',method,'--input-file',file,'--json']);
 if(!r.ok)throw new Error(tail(r.out));
 return JSON.parse(r.out);
}

const version=run(BB,['--version']).out.trim();
console.log("BB "+(version||"не отвечает"));

step('Типы (tsc)',()=>{const r=run('npm',['run','-s','typecheck']);return {ok:r.ok,note:r.ok?'':tail(r.out)};});
step('Тесты (npm test)',()=>{const r=run('npm',['test','--silent']);const m=r.out.match(/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);return {ok:r.ok,note:m?`прошло ${m[1]}, упало ${m[2]}`:tail(r.out)};});
const built=step('Сборка (bb plugin build)',()=>{const r=run(BB,['plugin','build','.']);return {ok:r.ok,note:r.ok?'':tail(r.out)};});
const loaded=built&&step('Проверка установленного плагина (health)',()=>{const r=run(BB,['plugin','reload','cyber-office']);
 // Строка «handlers: … N errors» это счётчик ошибок вызовов с запуска сервера, а не ошибка перезагрузки.
 const bad=r.out.split(/\r?\n/).filter(l=>!/^\s*handlers:/.test(l)&&/error|failed/i.test(l));
 return {ok:r.ok&&bad.length===0,note:r.ok&&!bad.length?'':tail(bad.join('\n')||r.out)};});
if(loaded&&PROJECT&&THREAD){
 step('Куски сервера (health)',()=>{
  const h=rpc('health',null);const off=h.features.filter(f=>!f.ok);
  if(!h.features.some(f=>f.id==='ask'&&f.ok))return {ok:false,note:'team_ask не зарегистрирован'};
  return {ok:off.length===0,note:off.length?off.map(f=>`${f.id} отключён (${f.error})`).join('; '):`включены: ${h.features.map(f=>f.id).join(', ')}`};
 });
 step('Офис (getTeam)',()=>{
  const t=rpc('getTeam',{projectId:PROJECT});
  return {ok:Array.isArray(t.team)&&t.team.length>0,note:`ролей ${t.team.length}, стажёров ${t.interns.length}, ждут ${t.waiting}`};
 });
 step('Блок в треде (getThreadCard)',()=>{
  const c=rpc('getThreadCard',{threadId:THREAD});
  return {ok:!!c&&!!c.who,note:c?`${THREAD}: ${c.who.name}, ${c.status}`:`${THREAD}: карточки нет`};
 });
 step('Журнал разноса (routeLog)',()=>{const l=rpc('routeLog',{threadId:THREAD});return {ok:Array.isArray(l),note:`записей ${l.length}`};});
 step('Прораб (getWaitingSummary, foremanStatus)',()=>{
  if(!rpc('getExperiments',null))return {ok:true,note:'экспериментальные функции выключены'};
  const summary=rpc('getWaitingSummary',{projectId:PROJECT});
  const {boards}=rpc('getBoards',{projectId:PROJECT});
  const states=boards.map(b=>rpc('foremanStatus',{boardId:b.id}));
  return {ok:Array.isArray(summary.items)&&states.every(s=>typeof s.enabled==='boolean'),note:`ждут ${summary.items.length}, включено досок ${states.filter(s=>s.enabled).length}`};
 });
 step('Радар (scoutStatus)',()=>{if(!rpc('getExperiments',null))return {ok:true,note:'экспериментальные функции выключены'};const {boards}=rpc('getBoards',{projectId:PROJECT});const st=boards.map(b=>rpc('scoutStatus',{boardId:b.id}));return {ok:st.every(s=>typeof s.enabled==='boolean'),note:`включено досок ${st.filter(s=>s.enabled).length}`};});
 step('Передачи (getPasses)',()=>{const {passes}=rpc('getPasses',{projectId:PROJECT});return {ok:Array.isArray(passes),note:`событий ${passes.length}`};});
 step('Доска Стаса (getBoards, dispatcherStatus)',()=>{
  if(!rpc('getExperiments',null))return {ok:true,note:'экспериментальные функции выключены'};
  const {boards}=rpc('getBoards',{projectId:PROJECT});
  if(!Array.isArray(boards))return {ok:false,note:'нет списка досок'};
  // Настоящий координатор должен оставаться без схемы, пока вы не включил её сам.
  const coord=THREAD;
  const st=rpc('dispatcherStatus',{threadId:coord});
  const usage=st.usage?`${Math.round((st.usage.usedTokens??0)/(st.usage.window||1)*100)}%`:'нет данных';
  return {ok:true,note:`досок ${boards.length}, строк ${boards.reduce((n,b)=>n+b.rows.length,0)}; координатор: схема ${st.entry?'включена':'выключена'}, контекст ${usage}`};
 });
}

const broken=results.filter(r=>!r.ok);
console.log('\n'+(broken.length===0
 ?'Всё работает. Офис, итог и разнос в треде проверьте глазами: откройте «Cyber Office» и тестовый тред.'
 :'Сломалось:\n'+broken.map(r=>`- ${r.name}${r.note?': '+r.note.split('\n')[0]:''}`).join('\n')+''));
console.log("BB "+(version||"не отвечает"));
process.exit(broken.length?1:0);
