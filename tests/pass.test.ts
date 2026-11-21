import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createFakePluginHost,makeThreadResponse} from '@get-bb/plugin-sdk/testing';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Тот же автономный загрузчик, что в тестах сервера: без BB CLI и живого BB.
const require=createRequire(import.meta.url),root=new URL('../',import.meta.url);
const cache=new Map<string,any>();
function load(file:string):any{
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('.css'))return {};
 if(file.endsWith('.json'))return JSON.parse(readFileSync(new URL(file,root),'utf8'));
 const source=readFileSync(new URL(/.tsx?$/.test(file)?file:file+(existsSync(new URL(file+'.ts',root))?'.ts':'.tsx'),root),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};cache.set(file,module.exports);
 vm.runInThisContext('(function(module,exports,require){'+output+'\n})')(module,module.exports,(s:string)=>s.startsWith('./')?load(s.slice(2)):require(s));
 cache.set(file,module.exports);return module.exports;
}
const P=load('pass-log');
const {registerDispatch}=load('dispatch-server');
const roster=load('team.json');
const event=(i=1)=>({at:i,from:'stas',to:'tara',task:'Импорт рекламы',threadId:'thr_tara1',kind:'dispatch'});
function world(){
 let n=0,at=Date.UTC(2026,10,10,11,10);const rows=new Map<string,any>();
 const add=(p:Record<string,unknown>)=>{const t=makeThreadResponse({projectId:'p',environmentId:'env_1',status:'idle',providerId:'claude-code',...p});rows.set(t.id,t);return t;};
 add({id:'thr_stas',title:'Песочница: Стас'});
 const {bb,harness}=createFakePluginHost({pluginId:'cyber-office',sdk:{threads:{
  get:async({threadId})=>{if(!rows.has(threadId))throw new Error('нет треда');return rows.get(threadId);},
  list:async(a={})=>[...rows.values()].filter(t=>!t.archivedAt&&(a.parentThreadId?t.parentThreadId===a.parentThreadId:a.hasParent?!!t.parentThreadId:t.projectId===a.projectId)),
  spawn:async p=>add({id:'thr_child'+(++n),title:p.title,parentThreadId:p.parentThreadId??null}),
  context:async()=>({usage:null}),defaultExecutionOptions:async()=>({model:'m',reasoningLevel:'low'}),send:async()=>({delivery:'queued'}),
 }}});
 const dispatch=registerDispatch(bb,{cardOf:async(key:string)=>roster.roles.find((r:any)=>r.id===key)??null,mirrorDir:null,now:()=>at});
 const passes=P.registerPassServer(bb);
 return {bb,harness,dispatch,passes,rows,tick:()=>++at};
}
const ctx={threadId:'thr_stas',projectId:'p'};

test('журнал: запись в kv, 300 последних, параллельные записи без потерь',async()=>{
 const {bb,harness}=world();
 await Promise.all(Array.from({length:310},(_,i)=>P.writePasses(bb,'b1',[event(i)])));
 const log=await bb.storage.kv.get<any[]>('passes:b1');
 assert.equal(log?.length,300);assert.equal(log?.[0].at,10);assert.equal(log?.at(-1).at,309);
 assert.equal(await bb.storage.kv.get('passes:b2'),undefined);
 assert.ok(harness.realtimeSignals.some((e:any)=>e.channel==='passes-changed'));
 await harness.lifecycle.dispose();
});
test('журнал: битые данные отбрасываются, UTF-8 помещается в лимит kv',()=>{
 assert.deepEqual(P.appendPasses({bad:1},[event(2)]),[event(2)]);
 assert.deepEqual(P.appendPasses([{...event(),kind:'bad'},null],[]),[]);
 const log=P.appendPasses([],Array.from({length:300},(_,i)=>({...event(i),task:'😀'.repeat(150)})));
 assert.ok(log.length>0&&log.length<=300);
 assert.ok(Buffer.byteLength(JSON.stringify(log),'utf8')<=240*1024);
});
test('директива: проверяет роли, тред и время; строит безопасную строку',()=>{
 const a={from:'user',via:'stas',to:'tara',task:'импорт рекламы',at:'18:10',thread:'thr_tara1'};
 assert.deepEqual(P.parsePassDirective(a),a);
 for(const patch of [{from:'???'},{via:'unknown'},{to:'unknown'},{to:'__proto__'},{from:'toString'},{thread:'other'},{thread:'thr_…'},{at:'25:10'},{task:''}])assert.equal(P.parsePassDirective({...a,...patch}),null);
 assert.equal(P.parsePassDirective({...a,via:undefined})?.via,undefined);
 const line=P.dispatchPassDirective('tara','импорт рекламы','thr_tara1',Date.UTC(2026,10,10,11,10));
 assert.equal(line,'::team-pass{from="user" via="stas" to="tara" task="импорт рекламы" at="18:10" thread="thr_tara1"}');
 const escaped=P.dispatchPassDirective('tara','Скажи "да" }\n::team-thread{id="thr_evil"}','thr_tara1',0);
 assert.match(escaped,/&quot;да&quot;/);assert.ok(!escaped.includes('\n'));assert.ok(!escaped.includes('} ::team-thread{'));
});
test('team_dispatch: готовая строка и два звена; review/done пишутся только при смене статуса',async()=>{
 const {harness,dispatch,passes,tick}=world();
 await dispatch.handlers.dispatcherEnable({threadId:ctx.threadId});
 const r=JSON.parse(String(await harness.behavior.callAgentTool('team_dispatch',{role:'tara',title:'Импорт рекламы',brief:'Импортировать' },ctx)));
 assert.equal(r.directive,'::team-pass{from="user" via="stas" to="tara" task="Импорт рекламы" at="18:10" thread="thr_child1"}');
 let log=(await passes.getPasses({projectId:'p'})).passes;
 assert.equal(log.length,2);assert.equal(log[0].from,'stas');assert.equal(log[0].to,'tara');assert.equal(log[1].from,'user');assert.equal(log[1].to,'stas');
 for(const status of ['review','review','done']){
  tick();await harness.behavior.callAgentTool('team_board_update',{id:r.row,status},ctx);
 }
 log=(await passes.getPasses({projectId:'p'})).passes;
 assert.deepEqual(log.map((e:any)=>e.kind),['done','review','dispatch','dispatch']);
 assert.equal(log[0].from,'tara');assert.equal(log[0].to,'stas');assert.equal(log[0].threadId,r.threadId);
 assert.deepEqual((await passes.getPasses({projectId:'other'})).passes,[]);
 await harness.lifecycle.dispose();
});
test('смена караула: запись от смены 1 к смене 2, повтор не дублирует',async()=>{
 const {harness,dispatch,passes,rows}=world();
 await dispatch.handlers.dispatcherEnable({threadId:ctx.threadId});
 for(let turn=0;turn<3;turn++){
  await harness.behavior.emitThreadEvent('thread.idle',{thread:rows.get(ctx.threadId),lastAssistantText:'В работе'});
 }
 const r=JSON.parse(String(await harness.behavior.callAgentTool('team_handoff',{note:'Задачи переданы'},ctx)));
 await harness.behavior.callAgentTool('team_handoff',{note:'Повтор'},ctx);
 const log=(await passes.getPasses({projectId:'p'})).passes;
 assert.equal(log.length,1);assert.equal(log[0].from,'shift:1');assert.equal(log[0].to,'shift:2');assert.equal(log[0].threadId,r.successor);
 await harness.lifecycle.dispose();
});
test('route: подтверждённая доставка берёт задачу и роль с доски',async()=>{
 const {bb,harness,dispatch,passes}=world();
 await dispatch.handlers.dispatcherEnable({threadId:ctx.threadId});
 const r=JSON.parse(String(await harness.behavior.callAgentTool('team_dispatch',{role:'tara',title:'Импорт рекламы',brief:'x'},ctx)));
 await P.logRoutePass(bb,{projectId:'p'},{roleId:'tara'},r.threadId,100);
 const log=(await passes.getPasses({projectId:'p'})).passes;
 const answer=log.find((e:any)=>e.kind==='answer');assert.equal(answer.from,'user');assert.equal(answer.to,'tara');assert.equal(answer.task,'Импорт рекламы');assert.equal(answer.threadId,r.threadId);
 await P.logRoutePass(bb,{projectId:'other'},{roleId:'tara'},r.threadId,101);
 assert.equal((await passes.getPasses({projectId:'p'})).passes.length,3);
 await harness.lifecycle.dispose();
});
test('группировка: задачи досок не смешиваются, новые события и группы сверху',()=>{
 const groups=P.groupPasses([{...event(2),boardId:'a'},{...event(4),boardId:'b'},{...event(3),boardId:'a'},{...event(1),boardId:'a',task:'Другая задача'}]);
 assert.deepEqual(groups.map((g:any)=>[g.boardId,g.events.map((e:any)=>e.at)]),[['b',[4]],['a',[3,2]],['a',[1]]]);
});
test('сбой kv журнала не ломает team_dispatch и готовую строку',async()=>{
 const {bb,harness,dispatch}=world();await dispatch.handlers.dispatcherEnable({threadId:ctx.threadId});
 const original=bb.storage.kv.set.bind(bb.storage.kv);
 bb.storage.kv.set=async(key,value)=>{if(key.startsWith('passes:'))throw new Error('kv unavailable');return original(key,value);};
 const r=JSON.parse(String(await harness.behavior.callAgentTool('team_dispatch',{role:'tara',title:'Импорт рекламы',brief:'x'},ctx)));
 assert.match(r.directive,/^::team-pass/);assert.equal(r.threadId,'thr_child1');
 await harness.lifecycle.dispose();
});
test('route: событие появляется только после подтверждения и успешного send',async()=>{
 for(const outcome of ['cancel','fail','queue']){
  const {bb,harness,dispatch,passes}=world();
  await dispatch.handlers.dispatcherEnable({threadId:ctx.threadId});
  const r=JSON.parse(String(await harness.behavior.callAgentTool('team_dispatch',{role:'tara',title:'Импорт рекламы',brief:'x'},ctx)));
  const {registerRouteServer}=load('route-server');registerRouteServer(bb,{noSend:[],cards:async()=>load('team.json').roles.map((r:any)=>({...r,enabled:true}))});
  if(outcome==='fail')harness.sdk.stub('threads.send',async()=>{throw new Error('ошибка отправки');});
  const done=harness.behavior.callAgentTool('team_route',{pieces:[{to:r.threadId,quote:'Импортируй рекламы'}]},ctx);
  let form:any;
  for(let i=0;i<100&&!form;i++){await new Promise<void>(resolve=>setImmediate(resolve));form=harness.inspection.pendingInteractions[0];}
  assert.ok(form,'форма открылась');
  assert.equal((await passes.getPasses({projectId:'p'})).passes.length,2,'до подтверждения события нет');
  if(outcome==='cancel')harness.behavior.cancelInteraction(form.id);
  else harness.behavior.submitInteraction(form.id,{rows:[{index:0,threadId:r.threadId,text:'Импортируй рекламы',send:true}]});
  await done;
  const answers=(await passes.getPasses({projectId:'p'})).passes.filter((e:any)=>e.kind==='answer');
  assert.equal(answers.length,outcome==='queue'?1:0);
  if(answers.length){assert.equal(answers[0].to,'tara');assert.equal(answers[0].task,'Импорт рекламы');}
  await harness.lifecycle.dispose();
 }
});
test('интерфейс: неверная директива показывает исходник, журнал даёт кнопки для звеньев',()=>{
 const {TeamPassDirective,PassList}=load('pass');
 const source='::team-pass{to="unknown"}';
 assert.match(renderToStaticMarkup(createElement(TeamPassDirective,{attributes:{to:'unknown'},source})),/::team-pass\{to=&quot;unknown&quot;\}/);
 const html=renderToStaticMarkup(createElement(PassList,{passes:[{...event(),boardId:'b1'}],onThread:()=>{}}));
 assert.match(html,/Stas/);assert.match(html,/Tara/);assert.match(html,/Импорт рекламы/);
 assert.equal((html.match(/<button/g)??[]).length,2);
 const noThread=renderToStaticMarkup(createElement(PassList,{passes:[{...event(),boardId:'b1',threadId:null}],onThread:()=>{}}));
 assert.doesNotMatch(noThread,/<button/);
});
