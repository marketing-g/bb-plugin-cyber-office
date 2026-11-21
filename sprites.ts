import {cyborgLook,glowOf,type LookSet} from './kiborgi.ts';
// Original 8-bit characters drawn in code. Each role is a 20 x 20 upper body
// (head and torso) that sits behind a desk. Layers override the shared base.
export type TeamStatusLike = 'waiting'|'error'|'working'|'delivered'|'free';
export const W = 20, H = 20;

const BASE = [
 '....................',
 '....................',
 '......kkkkkkkk......',
 '.....kssssssssk.....',
 '....kssssssssssk....',
 '....kssssssssssk....',
 '....kssssssssssk....',
 '....kssessssessk....',
 '....kssessssessk....',
 '....kscsssssscsk....',
 '....kssssmmssssk....',
 '.....kssssssssk.....',
 '.......kSSSSk.......',
 '...kooooowwoooook...',
 '..kooooooooooooook..',
 '..kOooooooooooooOk..',
 '..kOooooooooooooOk..',
 '..kOooooooooooooOk..',
 '..kOooooooooooooOk..',
 '..kOooooooooooooOk..',
];

export type Layer = Record<number,string>;
export interface Look {palette:Record<string,string>;layers:Layer[];glow?:{on:Record<string,string>;off:Record<string,string>}}

// The preview can draw another set of looks (cyborg directions in kiborgi.ts); null = base set.
let LOOK_TRANSFORM:((key:string,base:Look)=>Look)|null=null;
export function setLookTransform(fn:((key:string,base:Look)=>Look)|null){LOOK_TRANSFORM=fn;}

const SKIN_A = {s:'#f2c9a0',S:'#d9a77c',c:'#f2a7a0'};
const SKIN_B = {s:'#d9a479',S:'#b98559',c:'#e0907e'};
const SKIN_C = {s:'#a8724d',S:'#8a5a3a',c:'#c27a62'};
const SKIN_D = {s:'#f6d7b8',S:'#e0b48e',c:'#f5b1aa'};

const shortHair:Layer = {1:'......kkkkkkkk......',2:'.....khhhhhhhhk.....',3:'....khhhhhhhhhhk....',4:'....khhhhhhhhhhk....'};

export const LOOKS:Record<string,Look> = {
 stas:{palette:{s:'#c9d6e8',S:'#8c9cb5',c:'#c9d6e8',o:'#3f5f8f',O:'#2c4570',w:'#c9d6e8',a:'#5ff3ff',A:'#22a7c4',m:'#3a4b66'},layers:[{
  0:'.........aa.........',1:'.........kk.........',
  7:'....kAaaaaaaaaAk....',8:'....kAaaaaaaaaAk....',10:'....ksskkkkkkssk....',
  16:'.........aa.........',17:'........aaaa........'}]},
 ada:{palette:{...SKIN_D,h:'#2b2233',H:'#1a1420',o:'#7c5cd6',O:'#5a3fb0',w:'#f4f1ea',g:'#1d1b26'},layers:[{
  0:'........hhhh........',1:'.......khhhhk.......',2:'.....khhhhhhhhk.....',3:'....khhhhhhhhhhk....',4:'....khhhhhhhhhhk....',
  5:'....kh........hk....',6:'....kh........hk....'},{6:'......ggg..ggg......',7:'......geggggeg......',8:'......ggg..ggg......'}]},
 sherlock:{palette:{...SKIN_A,h:'#c46a2c',a:'#8a5a32',A:'#5e3a1c',o:'#b48a5a',O:'#8e6a42',w:'#efe6d4'},layers:[{
  0:'.......kkkkkk.......',1:'......kaAaAaAk......',2:'.....kAaAaAaAak.....',3:'...kaaaaaaaaaaaak...',4:'...kkkhhhhhhhhkkk...'}]},
 mark:{palette:{...SKIN_B,h:'#1f1a17',o:'#27375e',O:'#1a2645',w:'#f4f4f4',a:'#d8363f'},layers:[shortHair,{
  4:'....khhhhhhh..hk....',5:'....kh........hk....',
  14:'........waaw........',15:'.........aa.........',16:'.........aa.........',17:'.........aa.........',18:'........aaaa........',19:'.........aa.........'}]},
 radar:{palette:{...SKIN_C,h:'#1d2b1f',o:'#56663a',O:'#3e4b28',w:'#eef0e4',a:'#f2b233',A:'#b9831a'},layers:[shortHair,{
  14:'.......aA..Aa.......',15:'.......aa..aa.......',16:'........kkkk........'}]},
 nora:{palette:{...SKIN_A,h:'#e0602a',H:'#b9481c',o:'#3f9b62',O:'#2e7a4b',w:'#f4f1ea',a:'#ffd34d'},layers:[{
  1:'......kkkkkkkk......',2:'.....khhhhhhhhk.....',3:'....khhhhhhhhhhk....',4:'...khhhhhhhhhhhhkaa.',
  5:'...khhh......hhhk...',6:'...khh........hhk...',7:'...khh........hhk...',8:'...khh........hhk...',9:'...khh........hhk...',
  10:'...khh........hhk...',11:'...khh........hhk...',12:'...khhh......hhhk...',13:'...khhh......hhhk...'}]},
 sema:{palette:{...SKIN_C,a:'#1fb5a6',A:'#14857a',o:'#f08a2c',O:'#c96a17',w:'#fff4e0'},layers:[{
  1:'......kkkkkkkk......',2:'.....kaaaaaaaak.....',3:'....kaaaaaaaaaak....',4:'..kAAAAAAAAAAAAk....',
  14:'........w..w........',15:'........w..w........'}]},
 pixel:{palette:{...SKIN_D,h:'#1d1b26',a:'#ff5fa2',A:'#d23f82',o:'#f4f1ea',O:'#d8d2c4',w:'#2b3a7a'},layers:[{
  0:'.......kkkkkk.......',1:'.....kaaaaaaaak.....',2:'....kaaaaaaaaaaak...',3:'....khhhhhhhhhhk....',
  4:'....khh........k....',5:'....khh.......hk....',
  15:'...wwwwwwwwwwwwww...',17:'...wwwwwwwwwwwwww...',19:'...wwwwwwwwwwwwww...'}]},
 rams:{palette:{...SKIN_A,h:'#e8e8ee',o:'#2a2a34',O:'#1b1b22',w:'#2a2a34',g:'#1d1b26'},layers:[shortHair,{
  4:'....khh......hhk....',6:'......ggg..ggg......',7:'......geggggeg......',8:'......ggg..ggg......',12:'.......oooooo.......'}]},
 kadr:{palette:{...SKIN_B,h:'#5a3a22',a:'#1d1b26',A:'#e2463c',o:'#f2a23a',O:'#cf7f1c',w:'#fff2dc'},layers:[shortHair,{
  0:'.....aaaaaaaaaa.....',1:'....a.kkkkkkkk.a....',2:'...a.khhhhhhhhk.a...',
  5:'..AAA..........AAA..',6:'..AAA..........AAA..',7:'..AAA..........AAA..',8:'..AAA..........AAA..'}]},
 bolt:{palette:{...SKIN_C,a:'#ffc928',A:'#d99e00',o:'#3b6fd1',O:'#2a52a3',w:'#d8e4ff'},layers:[{
  0:'.......kkkkkk.......',1:'......kaaaaaak......',2:'.....kaaaAaaaak.....',3:'....kaaaaaaaaaak....',4:'...kAAAAAAAAAAAAk...',
  13:'...kooowooooowook...'}]},
 tara:{palette:{...SKIN_D,h:'#f0c25a',H:'#cf9d32',a:'#1d1b26',A:'#ff5a5a',o:'#d8363f',O:'#a8222b',w:'#fff0f0'},layers:[{
  1:'......kkkkkkkk......',2:'.....khhhhhhhhk.....',3:'....khhhhhhhhhhk....',4:'....khhhhhhhhhhkhh..',
  5:'....kh........hk.hh.',6:'.................hh.',7:'.................hh.',8:'..................h.'},{
  5:'...aa...............',6:'...aa...............',7:'...aa...............',8:'...a................',9:'...a................',10:'....aaA.............'}]},
 intern0:{palette:{...SKIN_A,h:'#6b4a2b',o:'#8fa3b8',O:'#6f8399',w:'#f4f1ea',b:'#3ddc84',a:'#3ddc84'},layers:[shortHair,{14:'.......a....a.......',15:'........a..a........',16:'.........bb.........',17:'.........bb.........'}]},
 intern1:{palette:{...SKIN_D,h:'#d94f7a',o:'#e6c35c',O:'#c9a43a',w:'#fff8e0',b:'#3ddc84',a:'#3ddc84'},layers:[{1:'......kkkkkkkk......',2:'.....khhhhhhhhk.....',3:'....khhhhhhhhhhk....',4:'...khhhhhhhhhhhhk...',5:'...khh........hhk...',6:'...kh..........hk...'},{14:'.......a....a.......',15:'........a..a........',16:'.........bb.........',17:'.........bb.........'}]},
 intern2:{palette:{...SKIN_C,h:'#1f1a17',o:'#5aa36a',O:'#3f7f4f',w:'#eaf7ea',b:'#ffd34d',a:'#ffd34d'},layers:[{1:'.....kkkkkkkkkk.....',2:'....khhhhhhhhhhk....',3:'....khhhhhhhhhhk....',4:'....khhkhhkhhkhk....'},{14:'.......a....a.......',15:'........a..a........',16:'.........bb.........',17:'.........bb.........'}]},
 intern3:{palette:{...SKIN_B,h:'#c9c2b8',o:'#7a6fd0',O:'#5a50b0',w:'#efeaff',b:'#59a8ff',a:'#59a8ff'},layers:[shortHair,{0:'........kk..........',4:'....khhhhh..hhhk....'},{14:'.......a....a.......',15:'........a..a........',16:'.........bb.........',17:'.........bb.........'}]},
};

const OUTLINE = '#1d1b26';
const COMMON:Record<string,string> = {k:OUTLINE,e:OUTLINE,m:'#9c4a4a',g:OUTLINE,w:'#f4f1ea'};

export function roleIds(){return Object.keys(LOOKS).filter(k=>!k.startsWith('intern'));}
/** Interns have ids like `intern-thr_x`; each gets one of four looks by hash. */
function lookKey(id:string){
 if(LOOKS[id])return id;
 if(id.startsWith('intern')){let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return 'intern'+(h%4);}
 return 'stas';
}
export interface SpriteStyle {look?:LookSet;glow?:string;avatar?:string}
export function lookOf(id:string,style?:SpriteStyle):Look{
 const k=lookKey(style?.avatar??id);const base=LOOKS[k];
 const look=style?.look?cyborgLook(k,base,style.look):LOOK_TRANSFORM?LOOK_TRANSFORM(k,base):base;
 return style?.glow?{...look,glow:glowOf(style.glow)}:look;
}

/** The final 20 x 20 grid of palette letters for a role. */
export function grid(id:string,status:TeamStatusLike='working',look=lookOf(id)):string[][]{
 const g=BASE.map(r=>[...r]);
 for(const layer of look.layers)for(const [row,line] of Object.entries(layer)){const y=Number(row);[...line].forEach((c,x)=>{if(c!=='.'&&x<W)g[y][x]=c;});}
 if(status==='free'){
  // Eyes closed: upper eye pixel becomes skin, lower becomes a lash line.
  for(const y of [7]) g[y]=g[y].map(c=>c==='e'?'s':c);
  for(const y of [8]) g[y]=g[y].map(c=>c==='e'?'k':c);
 }
 return g;
}

export interface Run {x:number;y:number;w:number;fill:string}
/** Horizontal runs of one colour, so a sprite is a few dozen rects, not 400. */
export function spriteRuns(id:string,status:TeamStatusLike='working',rows=H,style?:SpriteStyle):Run[]{
 const look=lookOf(id,style);const pal={...COMMON,...look.palette,...(look.glow?(status==='free'?look.glow.off:look.glow.on):{})};
 const g=grid(id,status,look);const out:Run[]=[];
 for(let y=0;y<Math.min(rows,H);y++){
  let x=0;
  while(x<W){const c=g[y][x];if(c==='.'||!pal[c]){x++;continue;}let w=1;while(x+w<W&&g[y][x+w]===c)w++;out.push({x,y,w,fill:pal[c]});x+=w;}
 }
 return out;
}

export function roleColor(id:string){const p=lookOf(id).palette;return p?.o??'#888';}
export function roleAccent(id:string){const p=lookOf(id).palette;return p?.a??p?.h??p?.o??'#888';}

// Desk props, 8 x 8. Shared palette.
const PROP_PAL:Record<string,string>={k:OUTLINE,w:'#f4f1ea',g:'#3ddc84',b:'#59a8ff',r:'#ff5a5a',y:'#ffd34d',A:'#b07a45',p:'#c58bff',s:'#9aa6b8'};
export const PROPS:Record<string,string[]>={
 ada:['........','......g.','......g.','...b..g.','...b..g.','r..b..g.','r..b..g.','kkkkkkkk'],
 sherlock:['..kkk...','.kwwwk..','.kwbwk..','.kwwwk..','..kkkA..','.....AA.','......AA','........'],
 mark:['..rrrr..','.rwwwwr.','rwrrrrwr','rwrkkrwr','rwrkkrwr','rwrrrrwr','.rwwwwr.','..rrrr..'],
 radar:['....g...','...g.g..','..g...g.','.g..y..g','....k...','....k...','...kkk..','..kkkkk.'],
 nora:['.wwwww..','.wkkkw.y','.wwwww.y','.wkkkw.y','.wwwww.y','.wkkkw.k','.wwwww..','........'],
 sema:['....ggg.','.....gg.','....g.g.','...g....','g.g.....','.g......','........','kkkkkkkk'],
 pixel:['..AAAA..','.AAAAAA.','AArAAbAA','AAAAAAA.','AAgAAy..','.AAAAAA.','..AAAA..','........'],
 rams:['..kkkk..','.wwkkww.','.wwwwwg.','.wwwwgw.','.wgwgww.','.wwgwww.','.wwwwww.','........'],
 kadr:['.kk..kk.','kwwkkwwk','.kk..kk.','kkkkkkk.','kssssskk','kssrsskk','kkkkkkk.','........'],
 bolt:['.kk.....','kssk....','.ksskk..','..ksssk.','...kssk.','....kssk','.....kk.','........'],
 tara:['......k.','....kkr.','kkkkrrr.','krrrrrr.','krrrrrr.','kkkkrrr.','..k.kkr.','..k...k.'],
 intern:['........','.kkkkk..','.kwwwkkk','.kwwwk.k','.kwwwkkk','.kwwwk..','..kkk...','........'],
 stas:['.kkkkkk.','kbbbbbbk','kbwbbwbk','kbbbbbbk','.kkkkkk.','...kk...','..kkkk..','........'],
};
function propPixels(rows:readonly string[],palette:Record<string,string>):Run[]{
 const out:Run[]=[];
 rows.forEach((row,y)=>{let x=0;while(x<row.length){const c=row[x];if(!palette[c]){x++;continue;}let w=1;while(row[x+w]===c)w++;out.push({x,y,w,fill:palette[c]});x+=w;}});
 return out;
}

export function propRuns(id:string):Run[]{
 return propPixels(PROPS[id]??(id.startsWith('intern')?PROPS.intern:[]),PROP_PAL);
}

const OFFICE_PALETTE={
 k:'var(--km-ink)',A:'var(--km-desk-top)',a:'var(--km-desk-edge)',m:'var(--km-chair)',
 M:'var(--km-chair-hi)',w:'var(--km-paper)',g:'var(--km-leaf)',G:'var(--km-leaf-hi)',
 b:'var(--km-done)',p:'var(--km-pot)',r:'var(--km-err)',y:'var(--km-wait)',
};
const OFFICE_PROPS={
 plant:[
  '.....GG.....','..g..GG..G..','..gG.GG.GG..','...gGGGgG...','....gGgG....',
  '.....gg.....','..kkkkkkkk..','..kppppppk..','...kppppk...','...kkkkkk...',
 ],
 cooler:[
  '...kkkkkk...','..kbbbbbbk..','..kbwbbbbk..','..kbwbbbbk..','...kkkkkk...',
  '..kwwwwwwk..','..kwrbwwwk..','..kwkkkkwk..','..kwwwwwwk..','..kkkkkkkk..',
 ],
 bookcase:[
  'kkkkkkkkkkkkkkkk','kAAAAAAAAAAAAAAk','ka..rbw..ygw..ak','ka..rbw..ygw..ak','kAAAAAAAAAAAAAAk',
  'ka.gGy..Mbrw..ak','ka.gGy..Mbrw..ak','kAAAAAAAAAAAAAAk','ka..bwwy..rg..ak','kkkkkkkkkkkkkkkk',
 ],
 sofa:[
  '...kkkkkkkkkkkkkk...','..kMMMMMMMMMMMMMMk..','..kMMMMMMMMMMMMMMk..','kkkmmmMmmmmMmmmmmkkk',
  'kMkMMMMMMMMMMMMMMkMk','kMMMMMMMMMMMMMMMMMMk','kmmmmmmmmmmmmmmmmmmk','kkkkkkkkkkkkkkkkkkkk',
  '..kk............kk..',
 ],
 board:[
  'kkkkkkkkkkkkkkkkkkkk','kwwwwwwwwwwwwwwwwwwk','kwwwbbbbbwwwwwwrwwwk','kwwwbwwwbwwwwrwrwwwk',
  'kwwwbbbbbwwwrwwrwwwk','kwwwwwgwwwwwwwwwwwwk','kwwwwwwwwwwwwwwwwwwk','kkkkkkkkkkkkkkkkkkkk',
  '...k............k...','...k............k...',
 ],
 coffee:[
  '.....kkkkkk.....','....kMMMMMMk....','....kMkrwMMk....','....kMkkkkMk....','....kM.wwkMk....',
  '....kM.ww.Mk....','....kkkkkkkk....','kkkkkkkkkkkkkkkk','.kAAAAAAAAAAAAk.','.ka..........ak.',
 ],
} as const;
export type OfficeProp=keyof typeof OFFICE_PROPS;
export function officePropRuns(id:OfficeProp){
 const rows=OFFICE_PROPS[id];
 return {width:rows[0].length,height:rows.length,pixels:propPixels(rows,OFFICE_PALETTE)};
}
