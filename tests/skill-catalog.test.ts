import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillCatalog,normalizeSkillCatalog} from '../skill-catalog.ts';
import {recommendSkills,skillCategory,type CatalogSkill} from '../skill-categories.ts';

test('catalog normalizes installed metadata supplied by BB',()=>{
 const description='  Visual layout\r\n\tand typography.  ';
 const rows=[
  {name:' visual-layout ',description,scope:'bb-project'},
  {name:'name-only',description:null,scope:'bb-builtin'},
  {name:' ',description:null,scope:'shared-user'},
  {name:'broken\r\nname',description:'not a catalog entry',scope:'plugin'},
  {name:'long-description',description:'🖼'.repeat(165),scope:'provider-user'},
 ] as const;
 const catalog=normalizeSkillCatalog(rows,true);
 assert.deepEqual(catalog.map(skill=>skill.name),['long-description','name-only','visual-layout']);
 assert.equal(catalog[0].description,'🖼'.repeat(160));
 assert.deepEqual(catalog[1],{name:'name-only',description:'',origin:'plugin',category:'other'});
 assert.deepEqual(catalog[2],{name:'visual-layout',description:'Visual layout and typography.',origin:'project',category:'design'});
});

test('project metadata wins over user metadata, and user wins over plugin',()=>{
 const rows=[
  {name:'Review',description:'Plugin version',scope:'plugin'},
  {name:'review',description:'Project version',scope:'provider-project'},
  {name:' REVIEW ',description:'User version',scope:'shared-user'},
 ] as const;
 assert.deepEqual(normalizeSkillCatalog(rows,true),[
  {name:'review',description:'Project version',origin:'project',category:'other'},
 ]);
 assert.deepEqual(normalizeSkillCatalog(rows,false),[
  {name:'REVIEW',description:'User version',origin:'user',category:'other'},
 ]);
 assert.equal(normalizeSkillCatalog(rows.slice(0,1),false)[0].origin,'plugin');
});

test('the catalog caps unique entries at 500 without dropping higher priority entries',()=>{
 const bulk=Array.from({length:530},(_,index)=>({name:`sample-${index}`,description:null,scope:'plugin' as const}));
 const catalog=normalizeSkillCatalog([...bulk,...bulk,{name:'project-review',description:null,scope:'shared-project'}],true);
 assert.equal(catalog.length,500);
 assert.equal(new Set(catalog.map(skill=>skill.name)).size,500);
 assert.ok(catalog.some(skill=>skill.name==='project-review'));
});

test('catalog caches empty results by project for one minute and shares concurrent reads',async()=>{
 let now=100;
 const reads:(string|undefined)[]=[];
 const catalog=createSkillCatalog({now:()=>now,read:async projectId=>{reads.push(projectId);return [];}});
 const first=catalog();
 assert.equal(catalog(),first);
 assert.deepEqual(await first,[]);
 await catalog('demo');
 now+=59_999;
 assert.equal(catalog(),first);
 now++;
 assert.notEqual(catalog(),first);
 await catalog();
 assert.deepEqual(reads,[undefined,'demo',undefined]);
});

test('catalog reads can be retried after a temporary SDK error',async()=>{
 let failed=false;
 const catalog=createSkillCatalog({read:async()=>{if(!failed){failed=true;throw new Error('Unavailable');}return [];}});
 await assert.rejects(catalog(),/Unavailable/);
 assert.deepEqual(await catalog(),[]);
});

test('English and Russian keywords classify skills by name or description',()=>{
 const cases=[
  ['research','Compare sources','Проводит интервью'],
  ['writing','Edit newsletter copy','Редактура писем'],
  ['design','Prepare visual mockups','Подбирает типографику'],
  ['code','Debug software','Отладка кода'],
  ['data','Compare metrics','Проверяет выгрузки'],
  ['marketing','Optimize campaigns','Планирует рекламу'],
  ['sales','Prepare negotiations','Готовит переговоры'],
  ['documents','Format a presentation','Оформляет протокол'],
  ['automation','Schedule recurring workflows','Настраивает рабочий процесс'],
  ['other','Organize assets','Группирует файлы'],
 ] as const;
 for(const [category,en,ru] of cases){
  assert.equal(skillCategory('sample',en),category,en);
  assert.equal(skillCategory('sample',ru),category,ru);
 }
 assert.equal(skillCategory('code-review','Audit source changes in a document'),'code');
 assert.equal(skillCategory('seo', ''),'marketing');
});

test('recommendations use job title keywords and cover both review and production work for the critic',()=>{
 const skills:CatalogSkill[]=[
  {name:'contrast-review',description:'Audit typography.',origin:'project',category:'design'},
  {name:'data-cleanup',description:'Normalize spreadsheet rows.',origin:'user',category:'data'},
  {name:'copy-polish',description:'Clarify a headline.',origin:'plugin',category:'writing'},
  {name:'acceptance-checklist',description:'Verify project acceptance.',origin:'plugin',category:'other'},
  {name:'handoff',description:'Schedule a meeting.',origin:'plugin',category:'automation'},
  {name:'slides',description:'Format slides.',origin:'plugin',category:'documents'},
 ];
 const names=(role:Parameters<typeof recommendSkills>[1])=>recommendSkills(skills,role).map(skill=>skill.name);
 assert.deepEqual(names({id:'pixel',role:'дизайнер'}),['contrast-review']);
 assert.deepEqual(names({id:'stas',role:'Coordinator'}),['handoff','slides']);
 assert.deepEqual(names({id:'rams',role:'Critic'}),['contrast-review','copy-polish','acceptance-checklist']);
 assert.deepEqual(names({id:'custom-a',custom:true,role:'Data analyst and copywriter'}),['data-cleanup','copy-polish']);
 assert.deepEqual(names({id:'custom-b',custom:true,role:'Редактор презентаций'}),['copy-polish','slides']);
 assert.deepEqual(names({id:'custom-c',custom:true,role:'Специалист по контролю качества'}),['contrast-review','acceptance-checklist']);
 assert.deepEqual(names({id:'custom-d',custom:true,role:'Specialist'}),[]);
});
