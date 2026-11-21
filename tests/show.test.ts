import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createFakePluginHost,makeThreadResponse} from '@get-bb/plugin-sdk/testing';

// Тот же transpile-адаптер, что в scout-server.test.ts.
const require=createRequire(import.meta.url),root=new URL('../',import.meta.url);
const cache=new Map<string,any>();
function load(file:string):any{
 file=file.replace(/\.(ts|tsx)$/,'');if(cache.has(file))return cache.get(file);
 if(file.endsWith('.json'))return JSON.parse(readFileSync(new URL(file,root),'utf8'));
 const source=readFileSync(new URL(file+(existsSync(new URL(file+'.ts',root))?'.ts':'.tsx'),root),'utf8');
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};cache.set(file,module.exports);
 vm.runInThisContext('(function(module,exports,require){'+out+'\n})')(module,module.exports,(spec:string)=>spec.startsWith('./')?load(spec.slice(2)):require(spec));
 cache.set(file,module.exports);return module.exports;
}
const show=load('show');
const {registerShow}=load('show-server');
const roster=load('team.json');

test('сценарий: все роли есть в команде, входы шагов существуют и идут раньше',()=>{
 const ids=new Set(roster.roles.map((r:any)=>r.id));const seen=new Set<string>();
 for(const s of show.SHOW_STEPS){
  assert.ok(ids.has(s.roleId),s.roleId);
  for(const a of s.after)assert.ok(seen.has(a),`${s.id} ждёт ${a}, который ещё не объявлен`);
  assert.ok(s.to==='user'||ids.has(s.to));seen.add(s.id);
  assert.doesNotMatch(s.task,/—/,'без длинного тире');
 }
 assert.equal(show.SHOW_BRAINS.model,'claude-haiku-5-5');assert.equal(show.SHOW_BUDGET_USD,2);
});

test('прогон: параллельные шаги, передача текста дальше, офис и стрелки',()=>{
 const run=show.newRun('r1','p',1000);
 assert.deepEqual(show.readySteps(run).map((s:any)=>s.id),['plan']);
 run.steps.plan={status:'done',text:'Sherlock: sales and feedback',threadId:'t0'};
 assert.deepEqual(show.readySteps(run).map((s:any)=>s.id),['data','voice']);
 run.steps.data={status:'done',text:'Марку: выходные утро +45%',threadId:'t1'};run.steps.voice={status:'working',threadId:'t2',startedAt:1500};
 assert.deepEqual(show.readySteps(run),[]);
 assert.deepEqual(show.showFlow(run),['stas','intake']);
 run.steps.voice={status:'done',text:'Марку: соседи дают 2 по цене 1',threadId:'t2'};
 const p=show.showPrompt(show.stepDef('offer'),run,{name:'Стас',role:'coordinator'});
 assert.match(p,/выходные утро \+45%/);assert.match(p,/2 по цене 1/);assert.match(p,/Sherlock: sales and feedback/,'бриф доходит до следующего шага');
 assert.match(p,/results\/r1\/2-offer\.md/);assert.match(p,/Fictional sales/);
 const team=roster.roles.map((r:any)=>({...r,status:'free',threads:[],current:null}));
 run.steps.offer={status:'working',threadId:'t3',startedAt:2000};
 const office=show.showTeam(team,run,'ru');const by=(id:string)=>office.find((r:any)=>r.id===id);
 assert.equal(by('stas').status,'working');assert.equal(by('stas').current.id,'t3');assert.equal(by('stas').current.handoffTo,'nora');
 assert.equal(by('sherlock').status,'free','Шерлок сдал, Стас уже взял');assert.equal(by('sherlock').current.title,'[Шерлок] Показ: Отзывы гостей и соседи');
 assert.equal(by('bolt').status,'free');assert.equal(by('bolt').current,null);
 assert.deepEqual(show.showFlow(run),['intake','strategy']);
 assert.ok(show.isShowTitle('[Ада] Показ: x'));assert.ok(!show.isShowTitle('[Ада] Тест: x'));
});

test('стоимость: неизвестная у начатого шага помечается',()=>{
 const run=show.newRun('r1','p',1000);
 run.steps.plan={status:'done',costUsd:0.05};run.steps.data={status:'working'};
 assert.deepEqual(show.sumCost(run),{usd:0.05,known:false});
 run.steps.data.costUsd=0.1;assert.equal(show.sumCost(run).known,true);
});

async function world(costPer=0.03){
 let clock=1_000_000,n=0;const spawns:any[]=[];const stops:string[]=[];const threads=new Map<string,any>();
 const {bb,harness}=createFakePluginHost({pluginId:'cyber-office',sdk:{
  projects:{list:async()=>[{id:'p_demo',name:'Demo: Breeze Coffee',sources:[{path:'C:/demo',isDefault:true}]},{id:'p_real',name:'Demo: Breeze Coffee Extra',sources:[]}]},
  threads:{
   spawn:async(p:any)=>{spawns.push(p);const t=makeThreadResponse({id:'t'+(++n),projectId:p.projectId,title:p.title,status:'active',createdAt:clock,updatedAt:clock});threads.set(t.id,t);return t;},
   get:async({threadId}:{threadId:string})=>threads.get(threadId),
   output:async()=>({output:''}),
   context:async()=>({usage:{cost:{amount:costPer,currency:'USD'},estimated:false,modelContextWindow:200000}}),
   stop:async({threadId}:{threadId:string})=>{stops.push(threadId);return {ok:true};},
  }}} as never);
 const s=registerShow(bb,{now:()=>clock,tickMs:3_600_000,readPoster:()=>'<svg xmlns="http://www.w3.org/2000/svg"/>',cardOf:async(id:string)=>({id,name:id,role:'роль'})});
 const idle=(id:string,text:string)=>harness.behavior.emitThreadEvent('thread.idle',{thread:{...threads.get(id),status:'idle'},lastAssistantText:text});
 return {bb,harness,s,spawns,stops,idle,threads,tick:(ms=0)=>{clock+=ms;return s.tick();}};
}

test('сервер: прогон в демо-проекте на Haiku, цепочка до итога',async t=>{
 const w=await world();t.after(()=>w.harness.lifecycle.dispose());
 const run=await w.s.handlers.showStart();
 assert.equal(run.projectId,'p_demo');assert.equal(w.spawns.length,1);
 assert.equal(w.spawns[0].model,'claude-haiku-5-5');assert.equal(w.spawns[0].permissionMode,'accept-edits');assert.match(w.spawns[0].title,/^\[stas\] Demo:/);
 await assert.rejects(w.s.handlers.showStart(),/already running/);
 await w.idle('t1','Аде: цифры');
 assert.equal(w.spawns.length,3,'Два исследования стартуют вместе');assert.equal(w.spawns[1].parentThreadId,'t1');
 await w.idle('t2','Марку: утро выходных');await w.idle('t3','Марку: соседи');
 assert.equal(w.spawns.length,4);assert.match(w.spawns[3].prompt,/утро выходных/);
 for(const [id,text] of [['t4','Норе: оффер'],['t5','Рамсу: тексты'],['t6','Рамсу: постер'],['t7','Таре: Принято'],['t8','Стасу: план'],['t9','Владельцу: итог']] as const)await w.idle(id,text);
 const st=await w.s.handlers.showState();
 assert.equal(st.run.state,'done');assert.equal(w.spawns.length,9);assert.ok(st.run.poster);
 assert.equal(st.run.costUsd,0.27);assert.ok(st.run.log.some((l:any)=>/Pixel/.test(l.text)));
});

test('сервер: стоп по кнопке и по потолку денег останавливает живые треды',async t=>{
 const w=await world();t.after(()=>w.harness.lifecycle.dispose());
 await w.s.handlers.showStart();await w.idle('t1','ok');
 const stopped=await w.s.handlers.showStop();
 assert.equal(stopped.state,'stopped');assert.deepEqual(w.stops.sort(),['t2','t3']);
 const w2=await world(1.5);t.after(()=>w2.harness.lifecycle.dispose());
 await w2.s.handlers.showStart();await w2.idle('t1','ok');
 await w2.tick();
 const st=await w2.s.handlers.showState();assert.equal(st.run.state,'budget');assert.ok(w2.stops.length>0);
});

test('сервер: без демо-проекта прогон не стартует, чужие треды не трогает',async t=>{
 const {bb,harness}=createFakePluginHost({pluginId:'cyber-office',sdk:{projects:{list:async()=>[{id:'p_real',name:'Демо-проект'}]}}} as never);
 t.after(()=>harness.lifecycle.dispose());
 const s=registerShow(bb,{tickMs:3_600_000,cardOf:async()=>null});
 await assert.rejects(s.handlers.showStart(),/empty folder.*Demo: Breeze Coffee/);
 assert.deepEqual((await harness.behavior.emitThreadEvent('thread.idle',{thread:makeThreadResponse({id:'x',projectId:'p_real',title:'чужой',status:'idle',createdAt:1,updatedAt:1}),lastAssistantText:'x'})).errors,[]);
});

test('границы прогона: треды показа не получают разнос, заголовок узнаётся с именем роли',()=>{
 const R=load('route');
 assert.match(R.blockReason({id:'x',title:'[Ада] Показ: Цифры продаж'})??'',/Demo/);
 assert.match(R.blockReason({id:'x',title:'[Нора] Тест: проверка'})??'',/Test/);
 assert.equal(R.blockReason({id:'x',title:'[Нора] Тексты акции'}),null);
 assert.equal(R.blockReason({id:'x',title:'Показательный разбор'}),null);
});
