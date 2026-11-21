// Ответ одним кликом и короткая карточка: node --experimental-strip-types --test tests/itog-answer.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerText,createSentLedger,freeAnswerText,isLongSummary,itogAnswerKey,itogDetails,parseItog,plural} from '../itog.ts';

const LONG=`статус: вопрос
итог: Собрал файл импорта рекламы на три кампании
от вас:
- Какой бюджет на тест | 3 500 | 5 000
- Что ещё проверить
файлы:
- /project/example.md
- docs/HANDOFF.md
- /project/example.md
проверено: импорт прошёл без ошибок
дальше: Тара собирает финальный файл
риски: пиксель /birthday молчит
замер: через 72 часа`;

test('ключ ответа различает сообщение, блок и пункт',()=>{
 assert.equal(itogAnswerKey('msg_1',0,1),'msg_1:0:1');
 assert.notEqual(itogAnswerKey('msg_1',0,1),itogAnswerKey('msg_1',1,1));
 assert.notEqual(itogAnswerKey('msg_1',0,1),itogAnswerKey('msg_2',0,1));
});

test('свой ответ: вопрос и текст, пустой не уходит',()=>{
 const ask={text:'Какой бюджет на тест?',options:['3 500']};
 assert.equal(freeAnswerText(ask,'  4 000, но с замером через 72 часа '),'Какой бюджет на тест: 4 000, но с замером через 72 часа');
 assert.equal(freeAnswerText(ask,'   '),'');
 assert.equal(freeAnswerText({text:'',options:[]},'да'),'да');
 // Клик по варианту и свой ответ дают одну форму.
 assert.equal(freeAnswerText(ask,'3 500'),answerText(ask,'3 500'));
});

test('журнал отправленного: второй раз не отправить, переживает перерисовку',()=>{
 const store=new Map<string,string>();
 const kv={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
 const a=createSentLedger(kv);
 assert.equal(a.get('m:0:0'),null);
 a.mark('m:0:0','3 500');
 assert.equal(a.get('m:0:0'),'3 500');
 // Новый журнал на том же хранилище (перезагрузка страницы) помнит ответ.
 const b=createSentLedger(kv);
 assert.equal(b.get('m:0:0'),'3 500');
 assert.equal(b.get('m:0:1'),null);
});

test('журнал без хранилища или с закрытым хранилищем живёт в памяти',()=>{
 const bad={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}};
 const a=createSentLedger(bad);
 assert.equal(a.get('x'),null);
 a.mark('x','да');
 assert.equal(a.get('x'),'да');
 const c=createSentLedger(null);c.mark('y','нет');assert.equal(c.get('y'),'нет');
});

test('короткая карточка: подробности свёрнуты в строку со счётчиком файлов',()=>{
 const it=parseItog(LONG);
 assert.deepEqual(itogDetails(it,'ru'),[
  {id:'files',label:'3 файла'},
  {id:'proof',label:'Проверено'},
  {id:'next',label:'Дальше'},
  {id:'extra',label:'Ещё 2'},
 ]);
 assert.deepEqual(itogDetails(parseItog('статус: готово\nитог: Сделал\nот вас: нет')),[]);
 assert.deepEqual(itogDetails(null),[]);
 assert.equal(itogDetails(parseItog('итог: x\nфайлы:\n- a.md'),'ru')[0].label,'1 файл');
 assert.equal(itogDetails(parseItog('итог: x\nфайлы:\n'+Array.from({length:11},(_,i)=>`- f${i}.md`).join('\n')),'ru')[0].label,'11 файлов');
});

test('итог длиннее строки сворачивается',()=>{
 assert.equal(isLongSummary('Файл импорта готов'),false);
 assert.equal(isLongSummary('а'.repeat(111)),true);
 assert.equal(isLongSummary('а'.repeat(40),30),true);
});

test('склонение',()=>{
 assert.deepEqual([1,2,5,11,12,21,22,25,101,111].map(n=>plural(n,'файл','файла','файлов')),
  ['файл','файла','файлов','файлов','файлов','файл','файла','файлов','файл','файлов']);
});
