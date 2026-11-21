import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createFakePluginHost,makeThreadResponse} from '@get-bb/plugin-sdk/testing';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const modules=new Map();
function load(file){
 file=file.replace(/\.(ts|tsx)$/,'');
 if(modules.has(file))return modules.get(file).exports;
 if(file.endsWith('.json'))return JSON.parse(readFileSync(new URL(file,root),'utf8'));
 const source=readFileSync(new URL(file+(existsSync(new URL(file+'.ts',root))?'.ts':'.tsx'),root),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};modules.set(file,module);
 vm.runInThisContext('(function(module,exports,require){'+output+'\n})')(module,module.exports,spec=>spec.startsWith('./')?load(spec.slice(2)):require(spec));
 return module.exports;
}
const plugin=load('server').default;
const row=(extra={})=>makeThreadResponse({id:'t',projectId:'p',title:'[Пиксель] Эскизы',status:'idle',...extra});
function host(rows=[row()]){return createFakePluginHost({pluginId:'cyber-office',sdk:{threads:{list:async args=>rows.filter(t=>args.hasParent?!!t.parentThreadId:t.projectId===args.projectId),get:async({threadId})=>{const t=rows.find(t=>t.id===threadId);if(!t)throw new Error('not found');return t;},defaultExecutionOptions:async()=>null}}});}

test('getSkillCatalog reads the installed SDK catalog and selected skills save with role edits',async()=>{
 const {bb,harness}=host();
 harness.sdk.stub('projects.list',async args=>{
  assert.deepEqual(args,{includePersonal:true});
  return [{id:'personal',kind:'personal'}];
 });
 harness.sdk.stub('skills.list',async({projectId,environmentId})=>{
  assert.equal(environmentId,null);
  const rows=[
   {name:'contrast-review',description:'Check typography.',scope:'provider-user'},
   {name:'contrast-review',description:'Review contrast\nand typography.',scope:'shared-project'},
  ];
  return {skills:projectId==='empty'?[]:rows};
 });
 plugin(bb);
 const rpc=(name,args)=>harness.behavior.callRpc(name,args);
 const [{name,description,origin,category}]=await rpc('getSkillCatalog',{projectId:'p'});
 assert.deepEqual({name,description,origin,category},{
  name:'contrast-review',description:'Review contrast and typography.',origin:'project',category:'design',
 });
 const [unscoped]=await rpc('getSkillCatalog',{});
 assert.equal(unscoped.origin,'user');
 assert.deepEqual(await rpc('getSkillCatalog',{projectId:'empty'}),[]);
 assert.equal((await rpc('getRole',{roleId:'pixel'})).card.skills.includes(name),false);
 const patch={skills:[name,'manual-skill'],hands:['Project files'],look:'c'};
 await rpc('updateRole',{roleId:'pixel',patch});
 const {card}=await rpc('getRole',{roleId:'pixel'});
 assert.deepEqual(card.skills,patch.skills);
 assert.deepEqual(card.hands,patch.hands);
 assert.equal(card.look,patch.look);
 assert.deepEqual(harness.inspection.sdk.callsTo('skills.list').length,3);
 await harness.lifecycle.dispose();
});

test('a custom role survives restart and joins the roster and thread binding',async()=>{
 const rows=[row({id:'named',title:'[Cedar Finch] Answer a question'}),row({id:'marked',title:'A freeform task'})];
 const first=host(rows);plugin(first.bb);
 const patch={name:'  Cedar Finch  ',role:'Accessibility reviewer',stage:'review',avatar:'intern2',look:'a',
  glow:'#8877cc',callsUser:'When approval is needed',hands:['Browser'],skills:['accessibility'],
  brains:{provider:'OpenAI / Codex',providerId:'codex',model:'GPT-6.1 Sol',modelId:'gpt-6.1-sol',effort:'high'}};
 const created=await first.harness.behavior.callRpc('updateRole',{roleId:null,patch});
 assert.match(created.id,/^custom-/);
 assert.equal(created.name,'Cedar Finch');
 assert.equal(created.custom,true);
 assert.equal(created.stage,'review');
 const tool=(c,name,args)=>c.harness.behavior.callAgentTool(name,args,{threadId:'named',projectId:'p'});
 const marked=JSON.parse(await tool(first,'team_mark',{threadId:'marked',role:'Cedar Finch'}));
 assert.equal(marked.role,created.id);
 const restarted=host(rows);
 await restarted.bb.storage.kv.set('custom-roles',await first.bb.storage.kv.get('custom-roles'));
 await restarted.bb.storage.kv.set('role:marked',await first.bb.storage.kv.get('role:marked'));
 await first.harness.lifecycle.dispose();
 plugin(restarted.bb);
 const rpc=(name,args)=>restarted.harness.behavior.callRpc(name,args);
 const team=()=>rpc('getTeam',{projectId:'p'});
 const selected=JSON.parse(await tool(restarted,'team_roster',{role:'accessibility reviewer'}));
 assert.equal(selected.id,created.id);
 assert.equal(selected.callsUser,patch.callsUser);
 assert.deepEqual(selected.brains,patch.brains);
 assert.deepEqual(selected.hands,patch.hands);
 assert.deepEqual(selected.skills,patch.skills);
 assert.ok(JSON.parse(await tool(restarted,'team_roster',{})).some(r=>r.id===created.id));
 assert.deepEqual((await team()).team.find(r=>r.id===created.id).threads.map(t=>t.id).sort(),['marked','named']);
 const edited=await rpc('updateRole',{roleId:created.id,patch:{stage:'make',role:'Quality specialist',avatar:'pixel'}});
 assert.equal(edited.stage,'make');
 assert.equal(edited.avatar,'pixel');
 assert.equal(edited.glow,patch.glow);
 assert.equal((await rpc('getRole',{roleId:created.id})).card.role,'Quality specialist');
 await rpc('updateRole',{roleId:created.id,patch:{enabled:false}});
 assert.ok((await rpc('getRoster',null)).some(r=>r.id===created.id&&r.enabled===false));
 assert.ok(!(await team()).team.some(r=>r.id===created.id));
 await assert.rejects(tool(restarted,'team_roster',{role:'Cedar Finch'}),/unavailable or disabled/);
 await assert.rejects(tool(restarted,'team_mark',{threadId:'marked',role:'Cedar Finch'}),/unavailable or disabled/);
 await rpc('deleteRole',{roleId:created.id});
 assert.ok(!(await rpc('getRoster',null)).some(r=>r.id===created.id));
 assert.ok(!(await team()).team.some(r=>r.id===created.id));
 await assert.rejects(rpc('deleteRole',{roleId:'pixel'}),/Only custom agents/);
 await restarted.harness.lifecycle.dispose();
});

test('custom role validation is localized and renaming, enabling and concurrent creation enforce unique names',async()=>{
 const {bb,harness}=host();plugin(bb);
 const rpc=(name,args)=>harness.behavior.callRpc(name,args);
 const save=(patch,roleId=null)=>rpc('updateRole',{roleId,patch});
 await assert.rejects(save({name:'  '}),/Enter a name/);
 await assert.rejects(save({name:'A'.repeat(41)}),/40 characters/);
 await assert.rejects(save({name:'Cedar',role:'A'.repeat(61)}),/60 characters/);
 await assert.rejects(save({name:' pIXEL '}),/already uses this name/);
 const saved=await save({name:'Cedar',role:'A'.repeat(60)});
 await assert.rejects(save({name:'Pixel'},saved.id),/already uses this name/);
 await save({enabled:false},saved.id);
 await save({name:'cedar'});
 await assert.rejects(save({enabled:true},saved.id),/already uses this name/);
 const attempts=await Promise.allSettled([save({name:'Orchid'}),save({name:'Orchid'})]);
 assert.deepEqual(attempts.map(a=>a.status).sort(),['fulfilled','rejected']);
 await rpc('setLanguage','ru');
 await assert.rejects(save({name:'  '}),/Введите имя/);
 await assert.rejects(save({name:'CEDAR'}),/имя уже используется/);
 await harness.lifecycle.dispose();
});
test('RPC reads team, interns and chains; optional model value',async()=>{
 const {bb,harness}=host([row({hasPendingInteraction:true}),row({id:'bench',title:'Unassigned'})]);plugin(bb);
 harness.sdk.stub('threads.defaultExecutionOptions',async()=>({model:'actual',reasoningLevel:'high'}));
 const data=await harness.behavior.callRpc('getTeam',{projectId:'p'});
 assert.equal(data.team.length,6);assert.equal(data.waiting,1);assert.equal(data.team.find(r=>r.id==='pixel').current.execution.model,'actual');
 assert.equal(data.interns.length,1);assert.equal(data.interns[0].current.id,'bench');assert.equal(data.interns[0].intern,true);
 assert.equal((await harness.behavior.callRpc('getChains',null)).blocks.length,10);
 await assert.rejects(harness.behavior.callRpc('getTeam',{projectId:''}));
 await harness.lifecycle.dispose();
});
test('empty project and model read failure remain honest',async()=>{
 const {bb,harness}=host();plugin(bb);harness.sdk.stub('threads.defaultExecutionOptions',async()=>{throw Error('unavailable');});
 const data=await harness.behavior.callRpc('getTeam',{projectId:'p'});assert.ok(data.team.find(r=>r.id==='pixel').current.executionError);
 const empty=await harness.behavior.callRpc('getTeam',{projectId:'empty'});assert.equal(empty.waiting,0);assert.ok(empty.team.every(r=>r.status==='free'));
 await harness.lifecycle.dispose();
});
test('thread listing failure does not masquerade as an empty project',async()=>{
 const {bb,harness}=host();plugin(bb);harness.sdk.stub('threads.list',async()=>{throw Error('read unavailable');});
 await assert.rejects(harness.behavior.callRpc('getTeam',{projectId:'p'}),/unavailable/);await harness.lifecycle.dispose();
});
test('server contains no thread mutation calls',()=>{
 const source=readFileSync(new URL('server.ts',root),'utf8');
 assert.doesNotMatch(source,/\b(?:spawn|send|archive|stop)\b|\bupdate\s*\(/);
});
test('team_roster reads and team_mark only writes plugin KV',async()=>{
 const {bb,harness}=host();plugin(bb);
 const roster=JSON.parse(await harness.behavior.callAgentTool('team_roster',{}));assert.equal(roster.length,6);
 const card=JSON.parse(await harness.behavior.callAgentTool('team_roster',{role:'Пиксель'}));assert.equal(card.id,'pixel');
 await assert.rejects(harness.behavior.callAgentTool('team_roster',{role:'ada'}),/unavailable or disabled/);
 await harness.behavior.callRpc('updateRole',{roleId:'ada',patch:{enabled:true}});
 await harness.behavior.callAgentTool('team_mark',{threadId:'t',role:'ada'},{threadId:'t',projectId:'p'});
 assert.equal(await bb.storage.kv.get('role:t'),'ada');
 const data=await harness.behavior.callRpc('getTeam',{projectId:'p'});assert.equal(data.team.find(r=>r.id==='ada').threads[0].id,'t');
 const ctx={threadId:'t',projectId:'p'};
 await assert.rejects(harness.behavior.callAgentTool('team_mark',{threadId:'t',role:'unknown'},ctx));
 await assert.rejects(harness.behavior.callAgentTool('team_mark',{threadId:'missing',role:'pixel'},ctx));
 await assert.rejects(harness.behavior.callAgentTool('team_mark',{threadId:'t',role:'pixel',extra:true},ctx));
 for(const method of ['threads.spawn','threads.send','threads.update','threads.archive','threads.stop'])assert.equal(harness.inspection.sdk.callsTo(method).length,0);
 await harness.lifecycle.dispose();
});

test('team_mark rejects another project before writing the role',async t=>{
 const {bb,harness}=host([row(),row({id:'foreign',projectId:'other'})]);plugin(bb);
 t.after(()=>harness.lifecycle.dispose());
 await assert.rejects(harness.behavior.callAgentTool('team_mark',{threadId:'foreign',role:'pixel'},{threadId:'t',projectId:'p'}),/only to threads in your own project/);
 assert.ok((await bb.storage.kv.get('role:foreign'))==null);
});
test('updateRole stores an override that team_roster and getTeam return',async()=>{
 const {bb,harness}=host();plugin(bb);
 const brains={provider:'OpenAI / Codex',providerId:'codex',model:'GPT-6.1 Sol',modelId:'gpt-6.1-sol',effort:'xhigh'};
 const saved=await harness.behavior.callRpc('updateRole',{roleId:'pixel',patch:{name:'Люмен',look:'c',glow:'#8844cc',brains,skills:['review']}});
 assert.equal(saved.name,'Люмен');assert.equal(saved.look,'c');assert.equal(saved.glow,'#8844cc');
 assert.equal(saved.brains.modelId,'gpt-6.1-sol');assert.equal(saved.customized,true);
 const card=JSON.parse(await harness.behavior.callAgentTool('team_roster',{role:'Люмен'}));assert.equal(card.brains.effort,'xhigh');assert.deepEqual(card.skills,['review']);assert.ok(card.hands.length>0);
 const all=JSON.parse(await harness.behavior.callAgentTool('team_roster',{}));assert.equal(all.find(r=>r.id==='pixel').brains.modelId,'gpt-6.1-sol');
 const team=await harness.behavior.callRpc('getTeam',{projectId:'p'});assert.equal(team.team.find(r=>r.id==='pixel').brains.model,'GPT-6.1 Sol');
 const role=await harness.behavior.callRpc('getRole',{roleId:'pixel'});assert.equal(role.defaults.brains.modelId,'claude-opus-5-5');assert.equal(role.defaults.brains.effort,'high');
 const reset=await harness.behavior.callRpc('resetRole',{roleId:'pixel'});assert.equal(reset.brains.modelId,'claude-opus-5-5');
 assert.equal(JSON.parse(await harness.behavior.callAgentTool('team_roster',{role:'pixel'})).customized,undefined);
 await assert.rejects(harness.behavior.callRpc('updateRole',{roleId:'nobody',patch:{}}));
 await assert.rejects(harness.behavior.callRpc('updateRole',{roleId:'pixel',patch:{name:' '}}));
 await harness.lifecycle.dispose();
});
test('thread pagination includes every page',async()=>{
 const {bb,harness}=host();plugin(bb);let calls=0;
 harness.sdk.stub('threads.list',async({offset})=>{calls++;return Array.from({length:offset===0?200:3},(_,i)=>row({id:String(offset+i)}));});
 const data=await harness.behavior.callRpc('getTeam',{projectId:'p'});assert.equal(data.team.find(r=>r.id==='pixel').threads.length,203);assert.equal(calls,4);
 await harness.lifecycle.dispose();
});
test('shared UI renders enabled roles and highlights any active thread',()=>{
 const {TeamView,Chains}=load('ui');const roles=load('team.json').roles;
 const {OfficeLanguage}=load('i18n-ui');
 const renderRu=(component,props)=>renderToStaticMarkup(createElement(OfficeLanguage.Provider,{value:'ru'},createElement(component,props)));
 const team=load('model').summarize(roles,[{id:'a',projectId:'p',title:'[Пиксель] active',status:'active',provider:'test'},{id:'b',projectId:'p',title:'[Пиксель] waiting',status:'idle',provider:'test',hasPendingInteraction:true}],'p').team;
 assert.equal(team.find(r=>r.id==='pixel').status,'waiting');
 const html=renderRu(TeamView,{data:{team,interns:[],waiting:1,fetchedAt:0},blocks:[],projects:[{id:'p',name:'Demo'}],projectId:'p',onProject(){},onThread(){}});
 assert.equal((html.match(/data-role=/g)||[]).length,5);assert.match(html,/Пульт Стаса/);assert.match(html,/Пиксель ждёт вас: открыть тред/);assert.match(html,/Ждут вас/);
 const chain=renderRu(Chains,{blocks:[{id:'s',title:'Design',steps:[{id:'d',title:'Draft',role:'pixel',output:'Result',needsUser:true}]}],team,initialPath:['s']});
 assert.match(chain,/km-node is-open is-waiting/);assert.match(chain,/исполнитель ждёт вас/);assert.match(chain,/нужен ваш ответ/);
});

test('thread card: who works, who receives, delegated children across projects',async()=>{
 const rows=[row({id:'coord',title:'Координировать задачи',pinnedAt:1}),row({id:'seo',projectId:'site',parentThreadId:'coord',title:'[Сёма] SEO аудит',status:'active'}),row({id:'help',projectId:'site',parentThreadId:'seo',title:'Сверить robots'})];
 const {bb,harness}=host(rows);plugin(bb);
 await harness.behavior.callRpc('updateRole',{roleId:'sema',patch:{enabled:true}});
 const team=await harness.behavior.callRpc('getTeam',{projectId:'p'});
 assert.equal(team.team.find(r=>r.id==='sema').status,'working');assert.equal(team.interns.length,1);
 const seo=await harness.behavior.callRpc('getThreadCard',{threadId:'seo'});
 assert.equal(seo.who.id,'sema');assert.equal(seo.handoff.id,'stas');assert.equal(seo.parent.id,'coord');assert.equal(seo.children.length,1);assert.equal(seo.children[0].who.intern,true);
 const coord=await harness.behavior.callRpc('getThreadCard',{threadId:'coord'});
 assert.equal(coord.who.id,'stas');assert.equal(coord.handoff.id,'user');assert.deepEqual(coord.children.map(c=>c.thread.id),['seo']);
 await harness.lifecycle.dispose();
});

test('disabled roles, role appearance and the critic survive server restart',async t=>{
 const initial=host([row({title:'[Ада] Анализ'})]);plugin(initial.bb);
 const rpc=(method,input)=>initial.harness.behavior.callRpc(method,input);
 assert.deepEqual((await rpc('getTeam',{projectId:'p'})).team.map(r=>r.id).sort(),['bolt','nora','pixel','rams','sherlock','stas']);
 assert.equal((await rpc('getRoster',null)).find(r=>r.id==='ada').enabled,false);
 await assert.rejects(rpc('updateRole',{roleId:'rams',patch:{enabled:false}}),/critic must stay enabled/);
 await Promise.all([rpc('updateRole',{roleId:'ada',patch:{enabled:true,name:'Призма'}}),rpc('updateRole',{roleId:'ada',patch:{look:'c',glow:'#ff0044'}})]);
 const override=await initial.bb.storage.kv.get('override:ada');
 await initial.harness.lifecycle.dispose();
 const restarted=host();t.after(()=>restarted.harness.lifecycle.dispose());
 await restarted.bb.storage.kv.set('override:ada',override);plugin(restarted.bb);
 const data=await restarted.harness.behavior.callRpc('getTeam',{projectId:'p'});
 const role=data.team.find(r=>r.id==='ada');
 assert.deepEqual([role.name,role.look,role.glow],['Призма','c','#ff0044']);
 const {spriteRuns}=load('sprites');
 assert.ok(spriteRuns(role.id,'working',20,role).some(r=>r.fill==='#ff0044'));
 await restarted.harness.behavior.callRpc('updateRole',{roleId:'ada',patch:{enabled:false}});
 assert.ok(!(await restarted.harness.behavior.callRpc('getTeam',{projectId:'p'})).team.some(r=>r.id==='ada'));
});

test('unavailable provider is shown on the card and resolves to project defaults',async t=>{
 const {bb,harness}=host();t.after(()=>harness.lifecycle.dispose());
 harness.sdk.stub('providers.list',async()=>[{id:'claude-code',available:false},{id:'codex',available:true}]);
 const defaults={providerId:'codex',model:'default-model',reasoningLevel:'medium'};
 harness.sdk.stub('projects.defaultExecutionOptions',async()=>defaults);
 plugin(bb);
 const {team}=await harness.behavior.callRpc('getTeam',{projectId:'p'});
 assert.equal(team.find(r=>r.id==='pixel').providerAvailable,false);
 const role=JSON.parse(await harness.behavior.callAgentTool('team_roster',{role:'pixel'},{projectId:'p'}));
 assert.deepEqual(role.execution,defaults);
});

test('language is shared by the roster, team, chains and thread cards across reload',async t=>{
 const {bb,harness}=host([row({title:'[Pixel] Two sketches'}),row({id:'old',title:'[Пиксель] Два эскиза'}),row({id:'custom',title:'[Lumen Desk] Review draft'}),row({id:'intern',title:'Unassigned'})]);
 plugin(bb);
 t.after(()=>harness.lifecycle.dispose());
 const rpc=(method,input)=>harness.behavior.callRpc(method,input);
 assert.equal(await rpc('getLanguage',null),'en');
 assert.equal((await rpc('getRole',{roleId:'Пиксель'})).card.name,'Pixel');
 assert.equal((await rpc('getChains',null)).blocks[0].title,'Client onboarding');
 await rpc('updateRole',{roleId:'pixel',patch:{name:'Lumen Desk'}});
 await rpc('setLanguage','ru');
 assert.equal(await bb.storage.kv.get('language'),'ru');
 assert.equal((await rpc('getChains',null)).blocks[0].title,'Подключение клиента');
 const restarted=await harness.lifecycle.reload(plugin);
 t.after(()=>restarted.harness.lifecycle.dispose());
 const read=(method,input)=>restarted.harness.behavior.callRpc(method,input);
 assert.equal(await read('getLanguage',null),'ru');
 const roster=await read('getRoster',null);
 assert.equal(roster.find(r=>r.id==='stas').name,'Стас');
 const team=await read('getTeam',{projectId:'p'});
 const pixel=team.team.find(r=>r.id==='pixel');
 assert.equal(pixel.name,'Lumen Desk');
 assert.equal(pixel.role,'дизайнер');
 assert.deepEqual(pixel.hands,['Редактор изображений','Браузер и скриншоты']);
 assert.deepEqual(pixel.threads.map(r=>r.id).sort(),['custom','old','t']);
 assert.match(team.interns[0].name,/^Стажёр /);
 assert.equal((await read('getThreadCard',{threadId:'custom'})).who.name,'Lumen Desk');
 await assert.rejects(read('setLanguage','de'));
 await read('setLanguage','en');
 assert.equal((await read('getRole',{roleId:'Lumen Desk'})).card.role,'Designer');
});
