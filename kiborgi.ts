// Cyborg directions for the office sprites. Switched in the preview with
// ?look=a|b|c; the plugin itself keeps the base set until one is chosen.
//   a: «Протез»  ordinary people, each with one cybernetic arm, cyan joints
//   b: «По роли» cybernetics that fits the job (eye, ocular, headset, tool arm)
//   c: «Серия»   one arm model for the whole team, joints and a temple port
//                glow in the role colour, so the head alone reads at 30 px
// Glow letters j (glow) and J (core) light up while a role works and dim when
// it is free. Metal: q light, Q mid, n dark.
import type {Layer,Look} from './sprites';

export type LookSet='base'|'a'|'b'|'c';
export const LOOK_SETS=[
 {id:'base',name:"current",note:"current_sprite_set"},
 {id:'a',name:"a_prosthetic",note:"people_with_cybernetic_arms_and_glowing"},
 {id:'b',name:"b_by_role",note:"role_specific_cybernetics_from_lenses_and"},
 {id:'c',name:"c_series",note:"a_shared_cybernetic_arm_with_role"},
] as const;
export function isLookSet(s:unknown):s is LookSet{return LOOK_SETS.some(l=>l.id===s);}

/** Builds a layer from [row, x, pixels] parts; every line is 20 wide. */
export function L(...parts:[number,number,string][]):Layer{
 const rows:Record<number,string[]>={};
 for(const [y,x,s] of parts){const r=rows[y]??=Array(20).fill('.');[...s].forEach((c,i)=>{if(x+i<20&&c!=='.')r[x+i]=c;});}
 return Object.fromEntries(Object.entries(rows).map(([y,r])=>[y,r.join('')]));
}
const mirror=(l:Layer):Layer=>Object.fromEntries(Object.entries(l).map(([y,s])=>[y,[...s].reverse().join('')]));

const METAL={q:'#c3cede',Q:'#7d8aa3',n:'#4b5670'};
// Glow colours differ by one step from screen and prop colours, so CSS can pulse only them.
const CYAN='#5ef3ff';
const DIM='#2b2f3d';
function mix(a:string,b:string,t:number){
 const p=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);
 return '#'+A.map((v,i)=>Math.round(v*(1-t)+B[i]*t).toString(16).padStart(2,'0')).join('');
}
export function glowOf(c:string){return {on:{j:c,J:mix(c,'#ffffff',.6)},off:{j:mix(c,DIM,.65),J:mix(c,DIM,.55)}};}

// Prosthetic arm on the viewer's right, bent at the elbow: a bulky shoulder that
// sticks out of the torso, glowing shoulder, elbow and wrist joints, and a metal
// hand with a raised thumb (x 10-12) that the desk hand covers at a desk.
export const ARM_R=L([12,15,'kkk'],[13,12,'k'],[13,14,'kqqqk'],[14,11,'kqkkqjQk'],[15,10,'kqqjQQqQk'],[16,10,'knqQQQjQk'],[17,10,'kkkkkkkkk']);
export const ARM_L=mirror(ARM_R);

// Stas was a robot; in every cyborg set he is a person with grey temples.
const STAS_HUMAN:Look={palette:{s:'#f2c9a0',S:'#d9a77c',c:'#f2a7a0',h:'#8d97a8',o:'#3f5f8f',O:'#2c4570',w:'#c9d6e8',a:'#5ff3ff',A:'#22a7c4'},layers:[
 L([1,6,'kkkkkkkk'],[2,5,'khhhhhhhhk'],[3,4,'khhhhhhhhhhk'],[4,4,'khhhhhhhhhhk'],[5,4,'kh'],[5,14,'hk'],[6,4,'kh'],[6,14,'hk']),
]};
const STAS_CORE=L([16,9,'jj']);
const STAS_HEADSET=L([2,5,'kqqjqqjqqk'],[3,4,'q'],[3,15,'q'],[4,4,'q'],[4,15,'q'],[5,4,'q'],[5,15,'q'],
 [6,3,'kq'],[6,15,'qk'],[7,3,'kj'],[7,15,'jk'],[8,3,'kq'],[8,15,'qk'],[9,14,'n'],[10,11,'jnnn']);
const TEMPLE=L([6,4,'Jj'],[7,4,'jq']);

const B_LAYERS:Record<string,Layer[]>={
 stas:[STAS_HEADSET],
 ada:[L([6,11,'qqqq'],[7,11,'qJjq'],[8,11,'qjjq'],[9,12,'nn'])],
 sherlock:[L([6,6,'nnn'],[7,5,'knjn'],[8,5,'knJn'],[9,6,'nnn'])],
 mark:[L([5,5,'qq'],[6,5,'jq'],[7,5,'qj'],[8,5,'q'])],
 radar:[L([0,5,'J'],[1,5,'n'],[2,5,'n'],[6,11,'qqq'],[7,11,'qJq'],[8,11,'qqq'])],
 nora:[ARM_L],
 sema:[L([0,16,'J'],[1,16,'n'],[2,16,'n'],[3,16,'n'],[4,16,'n'],[5,15,'qn'],[6,15,'jq'],[7,15,'qk'])],
 pixel:[ARM_R,L([15,8,'kk'],[16,7,'Jnnn'],[17,8,'kk'])],
 rams:[L([6,6,'qqq..qqq'],[7,6,'qJqqqqJq'],[8,6,'qjq..qjq'])],
 kadr:[L([5,2,'qqq'],[6,2,'qjq'],[7,2,'qJq'],[8,2,'qqq'],[5,15,'qqq'],[6,15,'qjq'],[7,15,'qJq'],[8,15,'qqq'],[9,4,'n'],[10,5,'j'])],
 bolt:[ARM_L,L([12,2,'kqq'])],
 tara:[L([5,3,'qq'],[6,3,'qj'],[7,3,'qq'],[8,3,'q'],[9,3,'q'],[10,4,'qqJ'])],
};
const INTERN_B=[L([6,4,'j'],[7,4,'J'])];

// Bright version of each role colour for set C (readable on dark and light).
export const ROLE_GLOW:Record<string,string>={stas:CYAN,ada:'#b49cff',sherlock:'#ffb86b',mark:'#7fa8ff',radar:'#b6f05a',nora:'#5dff9a',sema:'#2ff0dc',
 pixel:'#ff6fb5',rams:'#e6e6ff',kadr:'#ffb347',bolt:'#ffd83a',tara:'#ff6a6a',intern0:'#3edc85',intern1:'#3edc85',intern2:'#ffd44d',intern3:'#5aa8ff'};

/** The base look with the layers of a cyborg set on top. */
export function cyborgLook(key:string,base:Look,set:LookSet):Look{
 if(set==='base')return base;
 const human=key==='stas'?STAS_HUMAN:base;
 const palette={...METAL,...human.palette};
 if(set==='a')return {palette,layers:[...human.layers,ARM_R],glow:glowOf(CYAN)};
 if(set==='b')return {palette,layers:[...human.layers,...(B_LAYERS[key]??(key.startsWith('intern')?INTERN_B:[]))],glow:glowOf(CYAN)};
 return {palette,layers:[...human.layers,ARM_R,TEMPLE,...(key==='stas'?[STAS_CORE]:[])],glow:glowOf(ROLE_GLOW[key]??CYAN)};
}
/** The transform for sprites.setLookTransform; null keeps the base set. */
export function lookTransform(set:LookSet){return set==='base'?null:(key:string,base:Look)=>cyborgLook(key,base,set);}
/** Every colour a glow pixel can take while working, for the CSS pulse. */
export function glowColors(){return [...new Set([CYAN,...Object.values(ROLE_GLOW)])];}
