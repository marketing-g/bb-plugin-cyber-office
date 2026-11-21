import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const modules = new Map();
function load(file) {
 if (file.endsWith('.css')) return {};
 if (file.endsWith('.json')) return JSON.parse(readFileSync(new URL(file, root), 'utf8'));
 const name = file.replace(/\.(ts|tsx)$/, '');
 if (modules.has(name)) return modules.get(name).exports;

 const url = [name + '.ts', name + '.tsx'].map(p => new URL(p, root)).find(existsSync);
 const source = readFileSync(url, 'utf8');
 const {outputText} = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
 }});
 const module = {exports: {}};
 modules.set(name, module);
 const evaluate = vm.runInThisContext('(function(module,exports,require){' + outputText + '\n})', {filename: url.pathname});
 evaluate(module, module.exports, spec => spec.startsWith('./') ? load(spec.slice(2)) : require(spec));
 return module.exports;
}

const {Preview} = load('preview');
const render = search => renderToStaticMarkup(createElement(Preview, {search}));
const cyrillic = /[А-Яа-яЁё]/;

test('the office board shows the shift limit and disables invalid thread links',()=>{
 const {StasBoard}=load('ui');
 const html=renderToStaticMarkup(createElement(StasBoard,{
  boards:[{id:'b1',title:'Board',primary:false,currentThreadId:'shift-6',shifts:['shift-6'],shiftBlockedUntil:2,updatedAt:1,
   rows:[{id:'r1',task:'Unlinked task',roleId:'pixel',status:'working',threadId:null,invalidThread:true,updatedAt:1}]}],
  data:{team:[],interns:[],waiting:0,fetchedAt:1},people:new Map(),onThread(){},onCard(){},onClose(){},
 }));
 assert.match(html,/role="status">Handoff paused\. The board has reached the limit of 6 shifts in 24 hours\./);
 assert.match(html,/<button disabled="" title="Thread outside this board or unavailable">[\s\S]*Unlinked task/);
});

test('the Skills picker opens above Pixel with designer recommendations and 27 categorized skills',()=>{
 const html=render('?lang=en&card=pixel&picker=skills');
 const panel=html.split('class="km-picker"')[1];
 assert.match(html,/Role card for Pixel/);
 const [recommended,groups]=panel.split('<details');
 assert.match(recommended,/Recommended for this role/);
 assert.match(recommended,/contrast-review/);
 assert.doesNotMatch(recommended,/code-review/);
 assert.match(panel,/<summary>Design<b>4<\/b><\/summary>/);
 assert.equal((panel.match(/<details/g)??[]).length,10);
 assert.equal([...panel.matchAll(/<summary>[^<]+<b>(\d+)<\/b>/g)].reduce((sum,match)=>sum+Number(match[1]),0),27);
 for(const origin of ['Project','User','Plugin'])assert.match(panel,new RegExp(`km-picker-origin">${origin}<`));
 assert.match(panel,/aria-pressed="false"/);
 assert.match(panel,/href="https:\/\/skills\.sh" target="_blank" rel="noopener noreferrer"/);
 assert.match(panel,/href="https:\/\/github\.com\/anthropics\/skills" target="_blank" rel="noopener noreferrer"/);
 assert.doesNotMatch(panel,cyrillic);
 assert.ok(groups);
});

test('the Tools picker combines the default card with locale and theme',()=>{
 const html=render('?lang=en&theme=light&picker=tools');
 const panel=html.split('class="km-picker"')[1];
 assert.match(html,/Role card for Pixel/);
 assert.match(html,/data-theme="light"/);
 assert.match(panel,/The provider and MCP servers supply the agent’s tools/);
 for(const category of ['Files','Browser','Web','Terminal','Data','Media','Connectors']){
  assert.match(panel,new RegExp(`<summary>${category}<b>`));
 }
 assert.match(panel,/Project files/);
 assert.match(panel,/Video and audio editor/);
 assert.doesNotMatch(panel,/href=|[А-Яа-яЁё]/);
 const localized=render('?lang=ru&theme=light&card=ada&picker=tools');
 assert.match(localized,/Карточка Ада/);
 assert.match(localized,/Добавить инструменты/);
 assert.match(localized,/Список подключений показывает MCP Manager/);
});

test('the empty Skills picker keeps the recovery guidance and manual input available',()=>{
 const {RolePicker}=load('role-picker');
 const html=renderToStaticMarkup(createElement(RolePicker,{
  kind:'skills',role:{id:'pixel',role:'Designer'},initialSkills:[],selected:[],setSelected(){},onClose(){},
 }));
 assert.match(html,/No skills found on this computer/);
 assert.match(html,/Install a skill in your provider/);
 assert.match(html,/placeholder="Skill name"/);
 assert.doesNotMatch(html,/<details|[А-Яа-яЁё]/);
});

for (const [name, query, expected] of [
 ['office', '?lang=en&view=office&theme=dark', /Team office/],
 ['settings', '?lang=en&view=settings&theme=light', /<span>Language<\/span>/],
 ['role card', '?lang=en&theme=light&view=settings&card=pixel', /Role card for Pixel/],
 ['scheme', '?lang=en&view=scheme', /The team at a glance/],
 ['chains', '?lang=en&view=chains', /Client onboarding/],
 ['handoffs', '?lang=en&view=handoffs', /Handed off/],
 ['live demo', '?lang=en&view=office&show=mid', /Live demo/],
 ['finished demo', '?lang=en&view=office&show=done', /Open result thread/],
]) {
 test(`English preview renders ${name} without Cyrillic`, () => {
  const html = render(query);
  assert.match(html, expected);
  assert.doesNotMatch(html, cyrillic);
  if (name === 'role card') for (const label of ['Name', 'Appearance', 'Glow', 'Provider', 'Model', 'Effort']) {
   assert.match(html, new RegExp('>' + label + '(?:<| )'));
  }
 });
}

test('preview combines Russian, light theme, settings and an open role card', () => {
 const html = render('?lang=ru&theme=light&view=settings&card=pixel&show=done');
 assert.match(html, /data-theme="light"/);
 assert.match(html, /Карточка Пиксель/);
 assert.match(html, /Внешность/);
 assert.match(html, /Настройки/);
});

test('preview defaults to the English office', () => {
 const html = render('');
 assert.match(html, /Team office/);
 assert.doesNotMatch(html, cyrillic);
});

for (const [count, expected] of [[6, [5, 1]], [11, [5, 5, 1]], [14, [5, 5, 4]]]) {
 test(`the production stage seats ${count} agents and one empty desk`, () => {
  const html = render(`?lang=en&view=office&agents=${count}`);
  const production = html.split('data-stage="make"')[1].split('</section>')[0];
  const rows = production.split('<div class="km-desk-row">').slice(1);
  assert.deepEqual(rows.map(row => [...row.matchAll(/<article class="km-st /g)].length), expected);
  assert.match(rows.at(-1), /aria-label="Add an agent to Production"/);
  assert.equal([...html.matchAll(/class="km-st km-st-add"/g)].length, 5);
  assert.doesNotMatch(html, cyrillic);
 });
}

test('the English add-agent card and office props render without Cyrillic', () => {
 const html = render('?lang=en&view=office&add=1');
 assert.match(html, /role="dialog" aria-modal="true" aria-label="Add agent"/);
 assert.match(html, /<option value="make" selected="">Production<\/option>/);
 for (const label of ['Job title', 'Stage', 'Character', 'Appearance', 'Glow', 'Provider', 'Model', 'Effort', 'Tools', 'Skills', 'When you']) assert.ok(html.includes(label), label);
 assert.equal([...html.matchAll(/data-prop="[^"]+"[^>]+aria-hidden="true"/g)].length, 6);
 assert.match(render('?lang=en&view=settings'), /<button[^>]*>Add agent<\/button>/);
 assert.doesNotMatch(html, cyrillic);
 assert.match(render('?lang=ru&view=settings&add=1'), /aria-modal="true" aria-label="Добавить агента"/);
});
