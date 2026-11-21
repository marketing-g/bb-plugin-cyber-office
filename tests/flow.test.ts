import {test} from 'node:test';
import assert from 'node:assert/strict';
import roster from '../team.json' with {type:'json'};
import {summarize,type Role} from '../model.ts';
import {DEMO_STEPS,STAGES,demoTeam,liveFlows,restNote} from '../flow.ts';

const roles=roster.roles as Role[];
const team=summarize(roles,[],'p').team;

test('этапы покрывают всех, кроме Стаса, по одному разу',()=>{
 const ids=STAGES.flatMap(s=>s.roles).sort();
 assert.deepEqual(ids,roles.map(r=>r.id).filter(id=>id!=='stas').sort());
});
test('свободный без треда ждёт задачу от того, кто её даёт',()=>{
 const ada=team.find(r=>r.id==='sherlock')!;
 assert.deepEqual(restNote(ada,[],'ru'),{label:'Ждёт задачу',text:'Источник задачи: Стас'});
});
test('свободный с задачей в очереди доски показывает, к чему вернётся',()=>{
 const mark=team.find(r=>r.id==='nora')!;
 assert.deepEqual(restNote(mark,[{roleId:'nora',status:'todo',task:'[Марк] Оффер на ноябрь'}],'ru'),{label:'Вернётся к',text:'Оффер на ноябрь'});
});
test('прогон: на последнем шаге Стас ждёт вас, сдавшие помнят задачу',()=>{
 const last=demoTeam(team,DEMO_STEPS.length-1,'ru');
 assert.equal(last.find(r=>r.id==='stas')!.status,'waiting');
 const nora=last.find(r=>r.id==='nora')!;
 assert.equal(nora.status,'free');
 assert.deepEqual(restNote(nora,[],'ru'),{label:'Сдал',text:'Тексты акции'});
 assert.equal(last.filter(r=>r.status==='waiting').length,1);
});
test('прогон: каждый шаг даёт хотя бы одного занятого',()=>{
 for(let i=0;i<DEMO_STEPS.length;i++)assert.ok(demoTeam(team,i).some(r=>r.status!=='free'),'шаг '+i);
});
test('живая стрелка горит, когда в этапе кто-то работает',()=>{
 const t=demoTeam(team,4);
 const f=liveFlows(t);
 assert.ok(f.has('strategy>make'));
 assert.ok(!f.has('make>review'));
});
