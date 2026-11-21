import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createFakePluginHost,makeThreadResponse} from '@get-bb/plugin-sdk/testing';
import type {Board,BoardRow} from '../board.ts';

// Тот же transpile-адаптер, что в foreman.test.ts.
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
const {registerScout}=load('scout-server');
const H=3600_000,at=(h=12)=>new Date(2026,10,10,h).getTime();
const row=(p:Partial<BoardRow>={}):BoardRow=>({id:'r1',task:'Креативы рекламы',roleId:'pixel',status:'working',threadId:'kid',createdAt:at(9),updatedAt:at(11),...p});
const board=(rows:BoardRow[]):Board=>({id:'b1',projectId:'p',title:'Доска',primary:false,currentThreadId:'jar',shifts:['jar'],rows,updatedAt:at(9)});

async function world(rows:BoardRow[],jarTitle='Стас'){
 let clock=at(12);const spawns:{title:string;prompt:string;parentThreadId:string;model?:string}[]=[];
 const {bb,harness}=createFakePluginHost({pluginId:'cyber-office',sdk:{threads:{
  get:async({threadId}:{threadId:string})=>makeThreadResponse({id:threadId,projectId:'p',parentThreadId:threadId==='jar'?null:'jar',title:threadId==='jar'?jarTitle:'[Пиксель] x',status:'idle',createdAt:at(9),updatedAt:at(9)}),
  spawn:async(p:any)=>{spawns.push(p);return makeThreadResponse({id:'radar'+spawns.length,projectId:'p',title:p.title,status:'active',createdAt:clock,updatedAt:clock});},
 }}} as never);
 await bb.storage.kv.set('board:b1',board(rows));
 const s=registerScout(bb,{now:()=>clock,cardOf:async()=>({id:'radar',name:'Радар',brains:{providerId:'claude-code',modelId:'claude-opus-5-5',effort:'medium'}})});
 return {bb,harness,s,spawns,setTime:(n:number)=>{clock=n;},read:async()=>(await bb.storage.kv.get<Board>('board:b1'))!};
}

test('радар: выключен по умолчанию, сигнал раз в день, строка на доске, мозги из карточки',async t=>{
 const w=await world([row({reworks:3})]);t.after(()=>w.harness.lifecycle.dispose());
 await w.s.handlers.scoutEnable({boardId:'b1'}).catch(()=>{});
 await w.s.handlers.scoutDisable({boardId:'b1'});
 await w.harness.behavior.runSchedule('scout-signal');assert.equal(w.spawns.length,0,'выключен: молчит');
 await w.s.handlers.scoutEnable({boardId:'b1'});
 await w.harness.behavior.runSchedule('scout-signal');
 assert.equal(w.spawns.length,1);assert.equal(w.spawns[0].parentThreadId,'jar');assert.equal(w.spawns[0].model,'claude-opus-5-5');
 assert.match(w.spawns[0].prompt,/3 revisions/);assert.match(w.spawns[0].title,/^\[Радар\]/);
 const b=await w.read();assert.equal(b.rows.at(-1)!.roleId,'radar');assert.equal(b.rows.at(-1)!.threadId,'radar1');
 await w.harness.behavior.runSchedule('scout-signal');assert.equal(w.spawns.length,1,'второй раз за день нет');
 w.setTime(at(12)+24*H);await w.harness.behavior.runSchedule('scout-signal');assert.equal(w.spawns.length,1,'тот же затык повторно не зовёт');
});

test('радар: без сигнала молчит, недельный прогон идёт, тестовый Стас не трогается',async t=>{
 const w=await world([row()]);t.after(()=>w.harness.lifecycle.dispose());
 await w.s.handlers.scoutEnable({boardId:'b1'});
 await w.harness.behavior.runSchedule('scout-signal');assert.equal(w.spawns.length,0);
 await w.harness.behavior.runSchedule('scout-weekly');assert.equal(w.spawns.length,1);assert.match(w.spawns[0].prompt,/Weekly review/);assert.match(w.spawns[0].prompt,/- Креативы рекламы · pixel · working · thread kid/);
 const x=await world([row({reworks:5})],'Тест: Стас');t.after(()=>x.harness.lifecycle.dispose());
 await x.s.handlers.scoutEnable({boardId:'b1'});
 assert.match((await x.s.handlers.scoutRunNow({boardId:'b1'})).why,/is a test or archived/);assert.equal(x.spawns.length,0);
});
