// Страховка от обновлений BB: кусок без нужного API отключается, остальное живёт.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createFakePluginHost,makeThreadResponse,makePluginAgentConfigurationContext} from '@get-bb/plugin-sdk/testing';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const cache=new Map();
function load(file){
 file=file.replace(/\.(ts|tsx)$/,'');
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('.css'))return {};
 if(file.endsWith('.json'))return JSON.parse(readFileSync(new URL(file,root),'utf8'));
 const source=readFileSync(new URL(file+(existsSync(new URL(file+'.ts',root))?'.ts':'.tsx'),root),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};cache.set(file,module.exports);
 vm.runInThisContext('(function(module,exports,require){'+output+'\n})')(module,module.exports,spec=>spec.startsWith('./')?load(spec.slice(2)):require(spec));
 cache.set(file,module.exports);return module.exports;
}
const {missing,Health}=load('compat');
const plugin=load('server').default;
const rows=[makeThreadResponse({id:'thr_sandbox',projectId:'project-fixture',title:'Песочница Cyber Office',status:'idle'})];
function host(){return createFakePluginHost({pluginId:'cyber-office',agentSkillIds:['cyber-office','design-gate','team-setup'],sdk:{threads:{list:async a=>rows.filter(t=>a.hasParent?!!t.parentThreadId:t.projectId===a.projectId),get:async({threadId})=>{const t=rows.find(t=>t.id===threadId);if(!t)throw new Error('not found');return t;},defaultExecutionOptions:async()=>null}}});}

test('missing finds absent and non-function paths',()=>{
 const o={a:{b:()=>1,c:2}};
 assert.deepEqual(missing(o,['a.b','a.c','a.d','x.y']),['a.c','a.d','x.y']);
 assert.deepEqual(missing(o,undefined),[]);
});
test('Health keeps a failing feature off and others on',()=>{
 const logs=[];const h=new Health(m=>logs.push(m));
 assert.equal(h.run('itog',{},['slots.x'],()=>1),null);
 assert.equal(h.run('route',{},[],()=>{throw new Error('boom');}),null);
 assert.equal(h.run('office',{},[],()=>'ok'),'ok');
 assert.deepEqual(h.list().map(s=>[s.id,s.ok]),[['itog',false],['route',false],['office',true]]);
 assert.match(logs.join('\n'),/Missing in BB: slots\.x/);
});
test('server: all features on with the current SDK',async()=>{
 const {bb,harness}=host();plugin(bb);
 const h=await harness.behavior.callRpc('health',null);
 const off=h.features.filter(f=>!f.ok);
 assert.deepEqual(off,[]);
 for(const id of ['office','route','ask','itog-rules','roster-tools','thread-index'])assert.ok(h.features.some(f=>f.id===id&&f.ok),id);
 const conf=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
 assert.ok(conf.tools.some(t=>t.name==='team_ask'),'team_ask доступен агенту через configure');
 await harness.lifecycle.dispose();
});
test('server: BB without requestInput and contributeInstructions still serves the office',async()=>{
 const {bb,harness}=host();
 const ui=new Proxy(bb.ui,{get:(t,k)=>k==='requestInput'?undefined:t[k]});
 const agents=new Proxy(bb.agents,{get:(t,k)=>k==='contributeInstructions'?undefined:t[k]});
 const broken=new Proxy(bb,{get:(t,k)=>k==='ui'?ui:k==='agents'?agents:t[k]});
 plugin(broken);
 const team=await harness.behavior.callRpc('getTeam',{projectId:'project-fixture'});
 assert.equal(team.team.length,6);
 const h=await harness.behavior.callRpc('health',null);
 const state=id=>h.features.find(f=>f.id===id);
 assert.equal(state('route').ok,false);assert.match(state('route').error,/ui\.requestInput/);
 assert.equal(state('ask').ok,false);assert.match(state('ask').error,/ui\.requestInput/);
 const conf=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
 assert.ok(!conf.tools.some(t=>t.name==='team_ask'),'отключённый инструмент не выбирается');
 assert.equal(state('itog-rules').ok,false);
 assert.equal(state('office').ok,true);
 await assert.rejects(harness.behavior.callRpc('planRoute',{threadId:'thr_sandbox',role:'user',text:'x'}),/unavailable/);
 assert.deepEqual(await harness.behavior.callRpc('routeLog',{threadId:'thr_sandbox'}),[]);
 await harness.lifecycle.dispose();
});
test('app: a slot missing in BB turns off only its feature',()=>{
 const {feature,appHealth}=load('compat-app');
 const got=[];
 const app={slots:{navPanel:r=>got.push(['nav',r]),homepageSection:r=>got.push(['home',r]),messageAction:r=>got.push(['action',r])}};
 assert.equal(feature(app,'itog',a=>a.slots.experimental_codeFenceRenderer({id:'itog'})),false);
 assert.equal(feature(app,'ask',a=>a.slots.pendingInteraction({id:'team-ask-form'})),false);
 assert.equal(feature(app,'office',a=>{a.slots.navPanel({id:'k',component:()=>null});a.slots.homepageSection({id:'w',component:()=>null});}),true);
 assert.equal(feature(app,'itog-ask',a=>a.slots.messageAction({id:'ask',run:()=>{throw new Error('x');}})),true);
 assert.equal(appHealth.list().find(s=>s.id==='itog').ok,false);
 // Components are wrapped in the guard, actions swallow their errors.
 assert.notEqual(got[0][1].component.displayName,undefined);
 return got[2][1].run({});
});
