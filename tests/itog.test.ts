// Блок itog: node --experimental-strip-types --test tests/itog.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerText,isBadItog,judgeItog,parseItog} from '../itog.ts';
import {DESIGN_RULES,ITOG_RULES,ROLE_RULES,TEAM_RULES,itogRulesFor} from '../itog-rules.ts';
import {DISPATCHER_RULES} from '../board.ts';

const FULL=`статус: вопрос
итог: Собрал три заголовка для /демо, сильнее второй
от вас:
- Выбрать заголовок | 1 | 2 | 3
- Дать доступ к GA4
файлы:
- /project/example.md
проверено: сборка прошла, скриншоты 1440 и 390
дальше: Пиксель ставит заголовок в макет`;

test('полный блок',()=>{
 const it=parseItog(FULL);assert.ok(it);
 assert.equal(it.status,'вопрос');
 assert.equal(it.summary,'Собрал три заголовка для /демо, сильнее второй');
 assert.deepEqual(it.asks,[{text:'Выбрать заголовок',options:['1','2','3']},{text:'Дать доступ к GA4',options:[]}]);
 assert.equal(it.noAsks,false);
 assert.deepEqual(it.files,['/project/example.md']);
 assert.equal(it.proof,'сборка прошла, скриншоты 1440 и 390');
 assert.equal(it.next,'Пиксель ставит заголовок в макет');
 assert.deepEqual(it.extra,[]);
 assert.equal(judgeItog(it).level,'ok');
});

test('CRLF и пробелы по краям',()=>{
 const it=parseItog(FULL.replace(/\n/g,'\r\n')+'\r\n');assert.ok(it);
 assert.equal(it.summary,'Собрал три заголовка для /демо, сильнее второй');
 assert.equal(it.asks[0].options.length,3);
 assert.deepEqual(it.files,['/project/example.md']);
});

test('частичный блок во время стриминга',()=>{
 const partial='статус: готово\nитог: Собрал стран\nот Ста';
 const it=parseItog(partial,{streaming:true});assert.ok(it);
 assert.equal(it.status,'готово');
 assert.equal(it.summary,'Собрал стран','недописанная строка без двоеточия не липнет к итогу');
 assert.equal(it.fields.includes('от вас'),false);
 const one=parseItog('стат',{streaming:true});
 assert.equal(one,null,'одна недописанная строка ещё не итог');
 const half=parseItog('статус: готово\nитог: Со',{streaming:true});
 assert.equal(half?.summary,'Со','начатое поле видно сразу');
});

test('без поля итог блок плохой, рисуем исходник',()=>{
 const it=parseItog('статус: готово\nот вас: нет');assert.ok(it);
 assert.equal(it.summary,'');
 assert.deepEqual(judgeItog(it),{level:'broken',problems:['нет итога']});
 assert.equal(judgeItog(parseItog('просто текст без ключей')).level,'broken');
 assert.equal(parseItog(''),null);
 assert.equal(parseItog('const a = 1;\nreturn a'),null);
});

test('итог «работаю» и пустой итог плохие',()=>{
 for(const s of ['работаю','Работаю над заголовками','в процессе','смотрю файлы','ок']){
  const it=parseItog(`статус: работаю\nитог: ${s}\nот вас: нет`);
  assert.equal(isBadItog(it),true,s);
  assert.deepEqual(judgeItog(it).problems,['итог про процесс'],s);
  assert.equal(judgeItog(it).level,'weak',s);
 }
 const empty=parseItog('статус: готово\nитог:\nот вас: нет');
 assert.equal(judgeItog(empty).level,'broken');
 const good=parseItog('статус: работаю\nитог: Собрал 2 из 3 баннеров, третий к 18:00\nот вас: нет');
 assert.equal(judgeItog(good).level,'ok','статус «работаю» с результатом в итоге годится');
});

test('варианты ответа',()=>{
 const it=parseItog('статус: вопрос\nитог: Два эскиза\nот вас: Какой эскиз? | А | Б | А');assert.ok(it);
 assert.deepEqual(it.asks,[{text:'Какой эскиз?',options:['А','Б']}]);
 assert.equal(answerText(it.asks[0],'Б'),'Какой эскиз: Б');
 assert.equal(answerText(it.asks[0]),'Какой эскиз: ');
 assert.equal(answerText({text:'',options:['да']},'да'),'да');
 const numbered=parseItog('итог: x y z\nот вас:\n1. Цена | 120 | 150\n2) Срок');
 assert.deepEqual(numbered?.asks.map(a=>a.text),['Цена','Срок']);
});

test('от вас: нет',()=>{
 for(const v of ['нет','Нет','ничего','-']){
  const it=parseItog(`статус: готово\nитог: Файл импорта готов\nот вас: ${v}`);assert.ok(it);
  assert.equal(it.noAsks,true,v);assert.deepEqual(it.asks,[]);
  assert.equal(judgeItog(it).level,'ok',v);
 }
 const list=parseItog('итог: Файл готов\nстатус: готово\nот вас:\n- нет');
 assert.equal(list?.noAsks,true);
 const missing=parseItog('статус: готово\nитог: Файл импорта готов');
 assert.deepEqual(judgeItog(missing).problems,['нет поля «от вас»']);
 const q=parseItog('статус: вопрос\nитог: Есть вопрос по цене\nот вас: нет');
 assert.deepEqual(judgeItog(q).problems,['вопрос без вопроса']);
});

test('неизвестные ключи и статусы',()=>{
 const it=parseItog('статус: Готово.\nитог: Сайт выложен\nриск: кэш CDN до 10 минут\nеще строка риска\nот вас: нет\nссылка: https://Демо-проект.example/x');assert.ok(it);
 assert.equal(it.status,'готово');
 assert.deepEqual(it.extra,[{key:'риск',value:'кэш CDN до 10 минут\nеще строка риска'},{key:'ссылка',value:'https://Демо-проект.example/x'}]);
 const odd=parseItog('статус: почти\nитог: Сайт выложен\nот вас: нет');
 assert.equal(odd?.status,null);assert.equal(odd?.rawStatus,'почти');
 assert.deepEqual(judgeItog(odd).problems,['статус не из словаря']);
});

test('итог в несколько строк и файлы в кавычках',()=>{
 const it=parseItog('статус: частично\nитог: Собрал два баннера\nтретий жду от Кадра\nот вас: нет\nфайлы:\n- `C:\\work\\a.png`\n- C:\\work\\b.png');assert.ok(it);
 assert.equal(it.summary,'Собрал два баннера третий жду от Кадра');
 assert.deepEqual(it.files,['C:\\work\\a.png','C:\\work\\b.png']);
 assert.equal(it.extra.length,0,'путь «C:\\…» не принят за ключ');
});

test('правила: по проекту, без координатора и тредов «Тест:»',()=>{
 const titles:Record<string,string>={thr_t:'Тест: разнос',thr_a:'[Нора] Тексты'};
 const opts={projectIds:['proj_pvr'],excludeIds:['thr_coordinator'],titleOf:(id:string)=>titles[id]};
 assert.equal(itogRulesFor({threadId:'thr_a',projectId:'proj_pvr'},opts),TEAM_RULES);
 assert.equal(itogRulesFor({threadId:'thr_new',projectId:'proj_pvr'},opts),TEAM_RULES,'новый тред без заголовка получает правила');
 assert.equal(itogRulesFor({threadId:'thr_a',projectId:'proj_other'},opts),null);
 assert.equal(itogRulesFor({threadId:'thr_coordinator',projectId:'proj_pvr'},opts),null);
 assert.equal(itogRulesFor({threadId:'thr_t',projectId:'proj_pvr'},opts),null);
 assert.equal(itogRulesFor({threadId:'thr_a',projectId:'proj_x'},{...opts,projectIds:()=>['proj_x']}),TEAM_RULES,'список проектов можно отдавать функцией');
 assert.ok(ITOG_RULES.length<=1200,'правила до 1200 знаков: '+ITOG_RULES.length);
 assert.ok(TEAM_RULES.length<=2400,'с правилами ролей до 2400 знаков: '+TEAM_RULES.length);
 assert.ok(TEAM_RULES.startsWith(ITOG_RULES)&&TEAM_RULES.includes(ROLE_RULES));
 for(const r of ['R1. Ask at most one question per turn','R2. Check project files','R4. Work from an approved reference','R6.'])assert.ok(TEAM_RULES.includes(r),'есть '+r);
 assert.ok(TEAM_RULES.includes('R5. Group all manual checks')&&!TEAM_RULES.includes('R3.'),'Р5 всем, Р3 только диспетчеру');
 for(const r of ['R1.','R2.','R3.','R4.','R5.','R6.'])assert.ok(DISPATCHER_RULES.includes(r),'диспетчер знает '+r);
 assert.ok(ROLE_RULES.includes(DESIGN_RULES));
 assert.ok(!TEAM_RULES.includes('—')&&!DISPATCHER_RULES.includes('—'),'без длинного тире в правилах');
 assert.ok(!ITOG_RULES.includes('\u2014'),'без длинного тире');
 const example=/```itog\n([\s\S]*?)```/.exec(ITOG_RULES);
 assert.ok(example,'в правилах есть пример блока');
 assert.equal(judgeItog(parseItog(example[1])).level,'ok','пример из правил сам проходит проверку');
});

test('пути к файлам: абсолютные, относительные, внутри рабочей папки',async()=>{
 const {itogFileLink}=await import('../itog.ts');
 const ctx={hostId:'h1',environmentId:'env1',root:'D:\\demo-site'};
 assert.deepEqual(itogFileLink('D:\\Shared\\a b\\x.md',ctx).target,{kind:'host',hostId:'h1',path:'D:\\Shared\\a b\\x.md'});
 assert.deepEqual(itogFileLink('d:/Shared/x.md',ctx).target,{kind:'host',hostId:'h1',path:'D:\\Shared\\x.md'});
 assert.deepEqual(itogFileLink('`D:\\demo-site\\docs\\h.md`',ctx).target,{kind:'workspace',environmentId:'env1',path:'docs/h.md'});
 assert.deepEqual(itogFileLink('docs\\h.md',ctx).target,{kind:'workspace',environmentId:'env1',path:'docs/h.md'});
 assert.deepEqual(itogFileLink('./src/app.tsx:42',ctx,'ru'),{target:{kind:'workspace',environmentId:'env1',path:'src/app.tsx'},line:42,folder:false,why:'Открыть файл рабочей папки треда в BB'});
 assert.deepEqual(itogFileLink('C:\\data\\x.png (новый)',ctx).target,{kind:'host',hostId:'h1',path:'C:\\data\\x.png'});
 assert.deepEqual(itogFileLink('../Shared/x.md',ctx).target,{kind:'host',hostId:'h1',path:'D:\\Shared\\x.md'});
 assert.equal(itogFileLink('D:\\Shared\\Отчёты\\',ctx).folder,true);
 assert.equal(itogFileLink('https://example.com/a.md',ctx).target,null);
 const noEnv=itogFileLink('docs/h.md',{},'ru');assert.equal(noEnv.target,null);assert.match(noEnv.why,/нет рабочей папки/);
 assert.equal(itogFileLink('D:\\x.md',{}).target,null);
 assert.equal(itogFileLink('D:\\..\\x.md',ctx).target,null);
});

test('English and Russian itog fields and statuses produce the same result',()=>{
 const english=parseItog('status: done\nresult: Poster ready\nneeds you: nothing\nfiles:\n- docs/poster.svg\nchecked: Build passed\nnext: Share the draft');
 const russian=parseItog('статус: готово\nитог: Poster ready\nот вас: нет\nфайлы:\n- docs/poster.svg\nпроверено: Build passed\nдальше: Share the draft');
 assert.deepEqual({...english,rawStatus:''},{...russian,rawStatus:''});
 assert.equal(judgeItog(english).level,'ok');
 for(const [en,ru] of [['done','готово'],['partial','частично'],['question','вопрос'],['blocker','блокер'],['working','работаю']]){
  assert.equal(parseItog('status: '+en)?.status,ru);
 }
 assert.deepEqual(parseItog('status: question\nresult: Drafted the poster\nneeds you:\n- Publish? | Hold | Yes')?.asks,[{text:'Publish?',options:['Hold','Yes']}]);
 assert.equal(judgeItog(parseItog('status: working\nresult: Working on it\nneeds you: nothing')).level,'weak');
});

test('itog only offers file opening for allowlisted local formats',async()=>{
 const {canOpenItogFile,itogFileLink,isAbsolutePath}=await import('../itog.ts');
 const ctx={hostId:'h',environmentId:'env',root:'/workspace'};
 for(const ext of ['md','txt','csv','json','pdf','png','jpg','jpeg','webp','gif','docx','xlsx','pptx']){
  assert.equal(canOpenItogFile(itogFileLink('docs/report.'+ext,ctx)),true,ext);
 }
 assert.equal(canOpenItogFile(itogFileLink('D:\\Reports\\draft.PDF:17',ctx)),true);
 for(const path of ['file.exe','file.bat','file.cmd','file.lnk','file.html','file.svg','file.js','file.ps1','file.msi','README','report.pdf.exe','a.exe:stream.pdf','report.pdf/']){
  assert.equal(canOpenItogFile(itogFileLink(path,ctx)),false,path);
 }
 for(const path of ['\\\\machine\\share\\draft.pdf','//machine/share/draft.pdf','\\\\?\\D:\\Reports\\draft.pdf']){
  assert.equal(isAbsolutePath(path),false,path);
  const link=itogFileLink(path,ctx);
  assert.equal(link.target,null,path);
  assert.equal(canOpenItogFile(link),false,path);
 }
 assert.equal(itogFileLink('report.pdf',{...ctx,root:'//machine/share'}).target,null);
});
