import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';
const require=createRequire(import.meta.url);
const cache=new Map();
function load(file){
 file=file.replace(/\.ts$/,'');
 if(cache.has(file))return cache.get(file);
 const source=readFileSync(new URL('../'+file+'.ts',import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInThisContext('(function(module,exports,require){'+output+'\n})')(module,module.exports,spec=>spec.startsWith('./')?load(spec.slice(2)):require(spec));
 cache.set(file,module.exports);return module.exports;
}
const {registerAskServer}=load('ask-server');
const {ASK_FORM_ID,ASK_TIMEOUT_MS}=load('ask');
const input={question:'Какой образец?',options:[{id:'a',label:'Первый',image:'C:\\images\\a.png'},{id:'b',label:'Второй'}],defaultId:'b',context:'docs и история треда'};
const at=new Date(2026,10,10,20,0).getTime();
function host(t,now=()=>at){
 const {bb,harness}=createFakePluginHost({pluginId:'cyber-office'});
 registerAskServer(bb,{now});t.after(()=>harness.lifecycle.dispose());
 return {bb,harness};
}
const call=(h,inputValue=input,threadId='source',signal)=>h.behavior.callAgentTool('team_ask',inputValue,{threadId,projectId:'p',...(signal?{signal}:{})});
async function waitForm(h,threadId='source'){
 for(let i=0;i<30;i++){
  const form=h.inspection.pendingInteractions.find(f=>f.threadId===threadId);if(form)return form;
  await new Promise(r=>setImmediate(r));
 }
 throw new Error('Форма не открылась');
}

test('SDK: форма в исходном треде, ожидание до ответа, результат клика напрямую агенту',async t=>{
 const {harness:h}=host(t);let done=false;
 const promise=call(h).then(r=>{done=true;return r;});
 const form=await waitForm(h);
 assert.equal(form.rendererId,ASK_FORM_ID);assert.equal(form.timeoutMs,ASK_TIMEOUT_MS);
 assert.equal(form.payload.deadlineLabel,'02:00');assert.equal(form.payload.context,input.context);
 assert.equal(form.payload.options[0].image,input.options[0].image);assert.equal(done,false);
 h.behavior.submitInteraction(form.id,{by:'click',answer:'a'});
 assert.deepEqual(JSON.parse(await promise),{answer:'a',text:'Первый',by:'click'});
 assert.equal(h.inspection.pendingInteractions.length,0);
 assert.equal(h.sdk.callsTo('threads.send').length,0,'Нет сообщения в тред вместо результата инструмента');
});

test('SDK: свой ответ, затем новый вопрос в том же треде',async t=>{
 const {harness:h}=host(t);
 for(const text of [' Свой вариант ','Ещё один']){
  const promise=call(h);const form=await waitForm(h);
  h.behavior.submitInteraction(form.id,{by:'own',text});
  assert.deepEqual(JSON.parse(await promise),{answer:null,text:text.trim(),by:'own'});
 }
});

test('SDK: просроченный deadline сразу возвращает default без формы',async t=>{
 const {harness:h}=host(t);
 for(const deadline of ['19:59','20:00']){
  assert.deepEqual(JSON.parse(await call(h,{...input,deadline})),{answer:'b',text:`No answer by ${deadline}. Use the default option.`,by:'default'});
  assert.equal(h.inspection.pendingInteractions.length,0);
 }
});

test('SDK: таймаут requestInput выбирает default (реальный таймер harness)',async t=>{
 const nearEnd=new Date(2026,10,10,20,59,59,975).getTime();
 const {harness:h}=host(t,()=>nearEnd);
 const promise=call(h,{...input,deadline:'21:00'});const form=await waitForm(h);
 assert.equal(form.timeoutMs,25);
 assert.deepEqual(JSON.parse(await promise),{answer:'b',text:'No answer by 21:00. Use the default option.',by:'default'});
 assert.equal(h.inspection.pendingInteractions.length,0);
});

test('SDK: поздний клик после срока возвращает default',async t=>{
 let time=at;const {harness:h}=host(t,()=>time);
 const promise=call(h,{...input,deadline:'21:00'});const form=await waitForm(h);
 time=new Date(2026,10,10,21,0).getTime();
 h.behavior.submitInteraction(form.id,{by:'click',answer:'a'});
 assert.equal(JSON.parse(await promise).by,'default');
});

test('SDK: один открытый вопрос на тред, разные треды независимы',async t=>{
 const {harness:h}=host(t);
 const first=call(h);const f1=await waitForm(h);
 await assert.rejects(call(h),/question is already open/);
 const second=call(h,input,'other');const f2=await waitForm(h,'other');
 assert.equal(h.inspection.pendingInteractions.length,2);
 h.behavior.submitInteraction(f1.id,{by:'click',answer:'a'});
 h.behavior.submitInteraction(f2.id,{by:'click',answer:'b'});
 assert.deepEqual((await Promise.all([first,second])).map(r=>JSON.parse(r).answer),['a','b']);
});

test('SDK: неверные параметры, подмена ответа и пустой свой ответ отвергаются',async t=>{
 const {harness:h}=host(t);
 for(const bad of [{...input,defaultId:'x'},{...input,options:[input.options[0]]}])await assert.rejects(call(h,bad));
 assert.equal(h.inspection.pendingInteractions.length,0);
 for(const value of [{by:'click',answer:'fake'},{by:'click',answer:'a',text:'подмена'},{by:'own',text:' '}]){
  const promise=call(h);const rejected=assert.rejects(promise);const form=await waitForm(h);
  h.behavior.submitInteraction(form.id,value);await rejected;
 }
});

test('SDK: закрытие, abort и dispose отменяют вопрос и не выбирают default',async t=>{
 const {harness:h}=host(t);
 const first=call(h);const cancelled=assert.rejects(first,/cancelled/);const f1=await waitForm(h);
 h.behavior.cancelInteraction(f1.id);await cancelled;
 const controller=new AbortController();
 const second=call(h,input,'source',controller.signal);const aborted=assert.rejects(second);await waitForm(h);
 controller.abort();await aborted;assert.equal(h.inspection.pendingInteractions.length,0);
 const third=call(h);const disposed=assert.rejects(third,/cancelled|abort/i);await waitForm(h);
 await h.lifecycle.dispose();await disposed;
});
