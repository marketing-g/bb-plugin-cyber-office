// Радар, стратег-разведчик. Чистые функции без BB:
// когда звать, какой бриф дать. Запуск и расписание в scout-server.ts.
import type {Board,BoardRow} from './board';
import {DEFAULT_LANGUAGE,quoteLines,translator} from './i18n.ts';
// Своя копия plural из itog.ts: тесты грузят файл без сборщика, импорт без .ts не найдётся.

const HOUR=3600_000;
/** Сигнал: строка с двумя переделками или простоем у пользователя больше 4 часов. */
export const SCOUT_SIGNAL={reworks:2,waitedMs:4*HOUR} as const;

/** Счётчики, которые пишет Прораб. В старых досках их нет. */
type Counted=BoardRow&{reworks?:number;waitedMs?:number;waitingSince?:number|null;nudges?:number};

export interface ScoutPick {boardId:string;row:Counted;why:string;score:number}

/** Простой строки у пользователя на момент now: накопленный плюс текущее ожидание. */
export function waitedOf(row:Counted,now:number){
 const open=row.status==='waiting'&&row.waitingSince?Math.max(0,now-row.waitingSince):0;
 return (row.waitedMs??0)+open;
}

/** Самая дорогая строка за 7 дней, если она перешла порог. Иначе null. */
export function pickBottleneck(boards:Board[],now:number):ScoutPick|null{
 let best:ScoutPick|null=null;
 for(const b of boards)for(const raw of b.rows){
  const row=raw as Counted;if(now-row.updatedAt>7*24*HOUR)continue;
  const reworks=row.reworks??0,waited=waitedOf(row,now);
  if(reworks<SCOUT_SIGNAL.reworks&&waited<SCOUT_SIGNAL.waitedMs)continue;
  const score=reworks*2+waited/HOUR;
  const why=[reworks?`${reworks} ${reworks===1?'revision':'revisions'}`:'',waited>=HOUR?`${Math.round(waited/HOUR)} hr waiting for the user`:''].filter(Boolean).join(', ');
  if(!best||score>best.score)best={boardId:b.id,row,why,score};
 }
 return best;
}

/** Не чаще раза в день: ключ дня по времени компьютера. */
export function dayKey(now:number){const d=new Date(now);return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}

/** Понедельник 9:00 по времени компьютера: недельный прогон. */
export const SCOUT_WEEKLY_CRON='0 9 * * 1';

export const SCOUT_RULES=`Reply in the user's language

You are Radar, the Cyber Office scout. Use one thread and up to 30 minutes.
1. Propose one idea for the main bottleneck.
2. Read the board row and assignee thread. Look for existing solutions in repositories, agent skills, BB plugins, and case studies. Cite a URL for each claim.
3. Use an itog block with status: question, a one-line result, and needs you. Ask whether to try the experiment, with yes and no options and no as the default.
4. Under the block, use up to five lines for the idea, a trial under an hour, the metric, a numeric success threshold, and a fallback.
5. Stas assigns the trial after user approval. Share the proposal and wait for the user's decision.`;

/** Бриф Радара: строка доски и её счётчики, без пересказа чата. */
/** Строки доски для недельного прогона: у Радара нет инструментов доски, поэтому они идут в бриф. */
export function boardDigest(boards:Board[],now:number,limit=15):string[]{
 const rows=boards.flatMap(b=>b.rows.map(r=>r as Counted)).filter(r=>now-r.updatedAt<=7*24*HOUR&&r.roleId!=='radar').slice(-limit);
 return rows.map(r=>{const w=waitedOf(r,now);return `- ${r.task.slice(0,100)} · ${r.roleId} · ${r.status}${r.reworks?` · reworks ${r.reworks}`:''}${w>=HOUR?` · waited ${Math.round(w/HOUR)} hr for the user`:''}${r.threadId?` · thread ${r.threadId}`:''}`;});
}

export function scoutBrief(pick:ScoutPick|null,now:number,digest:string[]=[],lang=DEFAULT_LANGUAGE):string{
 const tr=translator(lang);
 const data=pick
  ?[tr('scout_prompt_signal',pick.boardId+'/'+pick.row.id,pick.why),
    tr('scout_prompt_task',pick.row.task),
    tr('scout_prompt_assignee',pick.row.roleId,pick.row.status,pick.row.threadId?tr('scout_prompt_thread',`::team-thread{id="${pick.row.threadId}"}`):''),
    pick.row.note?tr('scout_prompt_note',pick.row.note):'',tr('scout_prompt_reminders',pick.row.nudges??0)]
  :[tr('scout_prompt_digest'),...(digest.length?digest:[tr('scout_prompt_empty')])];
 return [SCOUT_RULES,pick?'':tr('scout_prompt_weekly'),tr('scout_prompt_started',new Date(now).toISOString().slice(0,16)),tr('board_prompt_data'),quoteLines(data.filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
}
