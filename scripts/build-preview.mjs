// Local offline CommonJS bundle, using the same TypeScript compiler as typecheck.
import ts from 'typescript';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const modules=[];const ids=new Map();
function add(file){
 file=path.resolve(file);if(ids.has(file))return ids.get(file);
 const id=modules.length;ids.set(file,id);modules.push('');
 if(file.endsWith('.json')){modules[id]=`function(module){module.exports=${readFileSync(file,'utf8')}}`;return id;}
 const code=readFileSync(file,'utf8');
 let output=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const req=createRequire(file);
 output=output.replace(/require\(["']([^"']+)["']\)/g,(_,spec)=>{
  if(spec.endsWith('.css'))return '({})';
  let target;
  if(spec.startsWith('.')){const base=path.resolve(path.dirname(file),spec);target=[base,base+'.tsx',base+'.ts',base+'.js',path.join(base,'index.js')].find(p=>existsSync(p));}
  else target=req.resolve(spec);
  if(!target)throw new Error('Cannot resolve '+spec+' from '+file);
  return `require(${add(target)})`;
 });
 modules[id]=`function(module,exports,require){${output}\n}`;return id;
}
const entry=add('preview.tsx');
writeFileSync('preview.js',`(()=>{const process={env:{NODE_ENV:'production'}};const modules=[${modules.join(',\n')}];const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}require(${entry});})();`);
writeFileSync('preview.css',['app.css','pass.css'].map(file=>readFileSync(file,'utf8')).join('\n'));
console.log('Built offline preview.js and preview.css');
