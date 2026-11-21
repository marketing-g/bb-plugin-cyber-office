import {test} from 'node:test';
import assert from 'node:assert/strict';
import {threadStatus,bindRole,summarize,type Role,type Thread} from '../model.ts';
const roles:Role[]=['stas','pixel'].map((id,i)=>({id,name:i?'Пиксель':'Стас',role:i?'дизайнер':'координатор',brains:{provider:'p',model:'m',effort:'medium'},hands:[],skills:[],takesFrom:[],givesTo:[],callsUser:''}));
const thread=(extra:Partial<Thread>={}):Thread=>({id:'t',projectId:'p',title:null,status:'idle',provider:'test',...extra});
test('status priority and conservative idle',()=>{
 assert.equal(threadStatus(thread({status:'error',hasPendingInteraction:true})),'waiting');
 assert.equal(threadStatus(thread({status:'error'})),'error');
 for(const status of ['active','starting','pending'])assert.equal(threadStatus(thread({status})),'working');
 assert.equal(threadStatus(thread()),'free');
 const s=summarize(roles,[thread({id:'a',title:'[Пиксель]',status:'active'}),thread({id:'b',title:'[Пиксель]',status:'error'})],'p');
 assert.equal(s.team[1].status,'error');
});
test('four binding rules and precedence',()=>{
 const t=thread({title:'[Пиксель] задача',pinnedAt:1});
 assert.equal(bindRole(t,roles,{t:'stas'}),'stas');
 assert.equal(bindRole(t,roles,{}),'pixel');
 assert.equal(bindRole(thread({title:'[дизайнер]'}),roles,{}),'pixel');
 assert.equal(bindRole(thread({pinnedAt:0}),roles,{}),'stas');
 assert.equal(bindRole(thread(),roles,{}, {p:'t'}),'stas');
 assert.equal(bindRole(thread({parentThreadId:'parent',pinnedAt:1}),roles,{}),null);
 assert.equal(bindRole(thread(),roles,{}),null);
});
test('two threads, interns, scope and empty project',()=>{
 const s=summarize(roles,[thread({id:'a',title:'[Пиксель]'}),thread({id:'b',title:'[Пиксель]',hasPendingInteraction:true}),thread({id:'c'}),thread({id:'other',projectId:'x'}),thread({id:'hidden',hidden:true})],'p');
 assert.equal(s.team[1].threads.length,2);assert.equal(s.team[1].current?.id,'b');assert.equal(s.waiting,1);assert.deepEqual(s.interns.map(i=>i.current?.id),['c']);assert.equal(s.interns[0].intern,true);
 assert.ok(summarize(roles,[],'p').team.every(r=>r.status==='free'));
});
test('delivered means an unread finished turn, not just idle',()=>{
 assert.equal(threadStatus(thread({latestAttentionAt:10,lastReadAt:5})),'delivered');
 assert.equal(threadStatus(thread({latestAttentionAt:10,lastReadAt:null})),'delivered');
 assert.equal(threadStatus(thread({latestAttentionAt:10,lastReadAt:10})),'free');
 assert.equal(threadStatus(thread({latestAttentionAt:10,lastReadAt:5,hasPendingInteraction:true})),'waiting');
});
test('role name as first word binds the thread',()=>{
 assert.equal(bindRole(thread({title:'Пиксель рекламы'}),roles,{}),'pixel');
 assert.equal(bindRole(thread({title:'Пиксель: эскизы'}),roles,{}),'pixel');
 assert.equal(bindRole(thread({title:'Пиксельный арт'}),roles,{}),null);
});
test('patch overrides brains, hands and skills only',async()=>{
 const {applyPatch,roleSteps}=await import('../model.ts');
 const r=applyPatch(roles[1],{brains:{provider:'OpenAI / Codex',providerId:'codex',model:'GPT-6.1 Sol',modelId:'gpt-6.1-sol',effort:'high'},hands:['ElevenLabs']});
 assert.equal(r.brains.modelId,'gpt-6.1-sol');assert.deepEqual(r.hands,['ElevenLabs']);assert.deepEqual(r.skills,[]);assert.equal(r.customized,true);assert.equal(r.name,'Пиксель');
 assert.equal(applyPatch(roles[1],null),roles[1]);
 const steps=roleSteps([{id:'a',title:'A',steps:[{id:'b',title:'B',role:'pixel',children:[{id:'c',title:'C',role:'pixel'}]}]}],'pixel');
 assert.deepEqual(steps.map(s=>[s.path.join('/'),s.step.id]),[['A','b'],['A/B','c']]);
});
test('every sprite row is 20 pixels wide',async()=>{
 const {LOOKS,grid}=await import('../sprites.ts');
 for(const [id,look] of Object.entries(LOOKS)){for(const layer of look.layers)for(const line of Object.values(layer))assert.equal(line.length,20,id+': '+line);assert.equal(grid(id).length,20);}
});

test('children in other projects belong to the team of their root',()=>{
 const s=summarize(roles,[thread({id:'coord',title:'Координировать задачи'}),thread({id:'seo',projectId:'site',parentThreadId:'coord',title:'[Пиксель] SEO',status:'active'}),thread({id:'stranger',projectId:'site',status:'active'})],'p',{},{p:'coord'});
 assert.equal(s.team[1].status,'working');assert.equal(s.team[1].current?.id,'seo');
 assert.equal(s.team[1].current?.handoffTo,'stas');
 assert.ok(![...s.team,...s.interns].some(r=>r.threads.some(t=>t.id==='stranger')));
 assert.equal(s.team[0].current?.handoffTo,'user');
});
test('role by meaning of the title or the brief',async()=>{
 const {guessRole}=await import('../model.ts');
 assert.equal(guessRole('Креативы рекламы'),'pixel');
 assert.equal(guessRole('Демо-проект: рекламы с нуля'),'tara');
 assert.equal(guessRole('Демо-проект: визуальная приёмка и тесты'),'rams');
 assert.equal(guessRole('SEO аудит сайта'),'sema');
 assert.equal(guessRole('Сценарий ролика'),'nora');
 assert.equal(guessRole('Подготовить презентацию для партнёров'),null);
 assert.equal(bindRole(thread({title:'Креатив для поста'}),roles,{}),'pixel');
 assert.equal(bindRole(thread({titleFallback:'Ты Пиксель, исполнитель'}),roles,{}),'pixel');
});
test('interns get stable names and hand off to the parent role',()=>{
 const threads=[thread({id:'coord',title:'Координировать'}),thread({id:'pix',title:'[Пиксель] эскизы',parentThreadId:'coord'}),thread({id:'help',title:'Помочь',parentThreadId:'pix',status:'active'}),thread({id:'help2',title:'Ещё помочь'})];
 const a=summarize(roles,threads,'p',{},{p:'coord'});const b=summarize(roles,[...threads].reverse(),'p',{},{p:'coord'});
 assert.equal(a.interns.length,2);assert.deepEqual(a.interns.map(i=>i.name),b.interns.map(i=>i.name));
 assert.notEqual(a.interns[0].name,a.interns[1].name);
 const helper=a.interns.find(i=>i.current?.id==='help')!;
 assert.equal(helper.current?.handoffTo,'pixel');assert.deepEqual(helper.givesTo,['Пиксель']);assert.equal(helper.status,'working');
});
test('step and ask links: thread, question, or why not',async()=>{
 const {stepLink,askLink}=await import('../model.ts');
 const s=summarize(roles,[thread({id:'w',title:'[Пиксель] эскизы',status:'active'}),thread({id:'q',title:'[Пиксель] вопрос',hasPendingInteraction:true})],'p');
 const pixel=s.team[1];
 assert.equal(stepLink(pixel,'pixel').threadId,'q');
 const a=askLink(pixel,'pixel');assert.equal(a.threadId,'q');assert.equal(a.live,true);
 const busy=summarize(roles,[thread({id:'w',title:'[Пиксель] эскизы',status:'active'})],'p').team[1];
 const b=askLink(busy,'pixel');assert.equal(b.threadId,'w');assert.equal(b.live,false);assert.match(b.why,/no question pending/i);
 const idle=summarize(roles,[],'p').team[1];
 const n=stepLink(idle,'pixel');assert.equal(n.threadId,null);assert.match(n.why,/no open thread for this step/);
 assert.match(askLink(idle,'pixel').why,/^No question pending\./);
 assert.match(stepLink(undefined,undefined).why,/no assigned role/);
 assert.match(stepLink(undefined,'ghost').why,/unavailable/);
});

test('both built-in languages and a custom name resolve to the same role',async()=>{
 const {default:roster}=await import('../team.json',{with:{type:'json'}});
 const {localizeRole,guessRole}=await import('../model.ts');
 const builtIn=roster.roles as Role[];
 const configured=builtIn.map(role=>localizeRole(role,'en',role.id==='pixel'?{name:'Studio Desk'}:undefined));
 for(const role of builtIn){
  const english=localizeRole(role,'en');
  for(const name of [role.name,english.name]){
   assert.equal(bindRole(thread({title:'['+name+'] Untitled'}),configured,{}),role.id);
  }
 }
 assert.equal(bindRole(thread({title:'[Studio Desk] Untitled'}),configured,{}),'pixel');
 assert.equal(bindRole(thread({titleFallback:"Reply in the user's language\n\nYou are Studio Desk (Designer)."}),configured,{}),'pixel');
 assert.equal(guessRole('Visual review of the poster'),'rams');
 assert.equal(guessRole('Audit search indexing'),'sema');
 assert.equal(guessRole('Edit a voiceover'),'kadr');
});
