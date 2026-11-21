// Cyborg sets: node --experimental-strip-types --test tests/kiborgi.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {LOOKS,grid,setLookTransform,spriteRuns} from '../sprites.ts';
import {LOOK_SETS,ROLE_GLOW,cyborgLook,lookTransform} from '../kiborgi.ts';

const ids=Object.keys(LOOKS);
const sets=LOOK_SETS.map(l=>l.id).filter(s=>s!=='base');

test('every cyborg layer row is 20 pixels wide',()=>{
 for(const set of sets)for(const id of ids){const look=cyborgLook(id,LOOKS[id],set);
  for(const layer of look.layers)for(const line of Object.values(layer))assert.equal(line.length,20,set+'/'+id+': '+line);}
});
test('base set is untouched until a set is chosen',()=>{
 const before=JSON.stringify(spriteRuns('ada'));
 setLookTransform(lookTransform('a'));assert.notEqual(JSON.stringify(spriteRuns('ada')),before);
 setLookTransform(lookTransform('base'));assert.equal(JSON.stringify(spriteRuns('ada')),before);
});
test('cyber parts glow while working and dim when free',()=>{
 for(const set of sets){setLookTransform(lookTransform(set));
  for(const id of ids){
   assert.ok(grid(id).flat().some(c=>c==='j'||c==='J'),set+'/'+id+' has no glowing part');
   const on=new Set(spriteRuns(id,'working').map(r=>r.fill)),off=new Set(spriteRuns(id,'free').map(r=>r.fill));
   assert.ok([...on].some(c=>!off.has(c)),set+'/'+id+' looks the same when free');
  }}
 setLookTransform(null);
});
test('set C glows in the colour of the role, Stas is a person in every set',()=>{
 setLookTransform(lookTransform('c'));
 assert.ok(spriteRuns('ada').some(r=>r.fill===ROLE_GLOW.ada));
 for(const set of sets){setLookTransform(lookTransform(set));assert.ok(!grid('stas')[7].includes('a'),set+': Stas still wears the visor');}
 setLookTransform(null);
});
