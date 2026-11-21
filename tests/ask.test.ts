import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ASK_TIMEOUT_MS,absoluteImagePath,askWindow,defaultAskAnswer,parseAsk,resolveAskAnswer} from '../ask.ts';
import {askLink,summarize,type Role,type Thread} from '../model.ts';

const input={question:'Какой образец оставляем?',options:[{id:'a',label:'Первый'},{id:'b',label:'Второй'}],defaultId:'b'};
const now=new Date(2026,10,10,20,0,30).getTime();

test('параметры: один вопрос, 2-4 варианта, уникальные id, обязательный defaultId',()=>{
 assert.deepEqual(parseAsk(input),input);
 assert.equal(parseAsk({...input,question:' Вопрос? ',context:' Искал в docs '}).context,'Искал в docs');
 const bad:unknown[]=[null,{}, {...input,question:''},{...input,question:'Один?\nДругой?'},
  {...input,options:[input.options[0]]},{...input,options:Array.from({length:5},(_,i)=>({id:String(i),label:'a'}))},
  {...input,options:[input.options[0],input.options[0]]},{...input,defaultId:undefined},{...input,defaultId:'x'},
  {...input,options:[{id:'a',label:'я'.repeat(61)},input.options[1]]},
  {...input,options:[{id:'a',label:'а\nб'},input.options[1]]},
  {...input,context:'docs\nистория'},{...input,deadline:'9:00'},{...input,deadline:'24:00'},{...input,deadline:'12:60'},
  {...input,extra:'x'}, {...input,options:[{id:'a',label:'a',unknown:1},input.options[1]]}];
 for(const value of bad)assert.throws(()=>parseAsk(value),JSON.stringify(value));
 for(const deadline of ['00:00','09:05','23:59'])assert.equal(parseAsk({...input,deadline}).deadline,deadline);
});

test('картинки: абсолютные локальные Windows и POSIX пути, без обхода и URL',()=>{
 for(const image of ['D:/example/test.png b.png','/project/example.JPG','/home/user/a.webp']){
  assert.equal(absoluteImagePath(image),true,image);
  assert.equal(parseAsk({...input,options:[{...input.options[0],image},input.options[1]]}).options[0].image,image);
 }
 for(const image of ['a.png','./a.png','C:a.png','https://a.test/a.png','fil/project/example.md:/a.png','C:\\..\\a.png','/home/../a.png','/a\u0000.png',
  '/project/example.md','C:/x/a.exe','C:/x/a.png.exe','C:/x/a.png ','C:/x/a.png.','C:/x/a.txt:b.png','/project/a.svg','/project/noext']){
  assert.equal(absoluteImagePath(image),false,image);
  assert.throws(()=>parseAsk({...input,options:[{...input.options[0],image},input.options[1]]}));
 }
});

test('картинки: UNC-пути не проходят ни проверку пути, ни схему формы',()=>{
 for(const image of ['\\\\machine\\share\\a.png','//machine/share/a.png','\\/machine/share/a.png']){
  assert.equal(absoluteImagePath(image),false,image);
  assert.throws(()=>parseAsk({...input,options:[{...input.options[0],image},input.options[1]]}));
 }
});

test('срок сегодня по локальному времени, прошедший не переносится на завтра',()=>{
 const window=askWindow({deadline:'21:00'},now);
 assert.equal(window.expiresAt,new Date(2026,10,10,21,0).getTime());
 assert.equal(window.deadlineLabel,'21:00');
 assert.ok(askWindow({deadline:'19:59'},now).expiresAt<now);
 assert.equal(askWindow({deadline:'20:00'},now).expiresAt,new Date(2026,10,10,20,0).getTime());
 assert.equal(askWindow({},now).expiresAt-now,ASK_TIMEOUT_MS);
 assert.equal(askWindow({},now).deadlineLabel,'02:00');
});

test('ответ: клик, свой текст, дефолт на границе срока и после, текст строго по контракту',()=>{
 const ask=parseAsk({...input,deadline:'21:00'});const window=askWindow(ask,now);
 assert.deepEqual(resolveAskAnswer(ask,window,{by:'click',answer:'a'},now),{answer:'a',text:'Первый',by:'click'});
 assert.deepEqual(resolveAskAnswer(ask,window,{by:'click',answer:'b'},now),{answer:'b',text:'Второй',by:'click'});
 assert.deepEqual(resolveAskAnswer(ask,window,{by:'own',text:'  Третий\nс пояснением  '},now),{answer:null,text:'Третий\nс пояснением',by:'own'});
 const fallback={answer:'b',text:'No answer by 21:00. Use the default option.',by:'default'};
 assert.deepEqual(defaultAskAnswer(ask,window),fallback);
 for(const at of [window.expiresAt,window.expiresAt+1])assert.deepEqual(resolveAskAnswer(ask,window,{by:'click',answer:'a'},at),fallback);
 for(const value of [null,{by:'click',answer:'x'},{by:'click',answer:'a',text:'подмена'},{by:'default'},
  {by:'own',text:' '},{by:'own',text:'я'.repeat(4001)},{by:'own',text:'текст',answer:'a'}])assert.throws(()=>resolveAskAnswer(ask,window,value,now));
});

test('ожидание формы уже входит в счётчик и ссылку на вопрос, в том числе у занятого агента',()=>{
 const role:Role={id:'pixel',name:'Пиксель',role:'дизайнер',brains:{provider:'p',model:'m',effort:'low'},hands:[],skills:[],takesFrom:[],givesTo:[],callsUser:''};
 const thread:Thread={id:'ask',projectId:'p',title:'[Пиксель] Образец',status:'active',provider:'test',hasPendingInteraction:true};
 const result=summarize([role],[thread,{...thread,id:'work',hasPendingInteraction:false}],'p');
 assert.equal(result.waiting,1);assert.equal(result.team[0].status,'waiting');
 assert.equal(result.team[0].current?.id,'ask');assert.equal(askLink(result.team[0]).threadId,'ask');
 assert.equal(askLink(result.team[0]).live,true);
 const closed=summarize([role],[{...thread,hasPendingInteraction:false}],'p');
 assert.equal(closed.waiting,0);assert.equal(closed.team[0].status,'working');
});
