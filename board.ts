// Доска Стаса-диспетчера: память координатора вместо чата.
// Чистые функции и тексты, без BB: их проверяют тесты, сервер (dispatch-server.ts) хранит доску в kv.

export const BOARD_STATUSES=['todo','working','waiting','review','done','dropped'] as const;
export type BoardStatus=typeof BOARD_STATUSES[number];
export const BOARD_STATUS_TEXT:Record<BoardStatus,string>={todo:'Queued',working:'In progress',waiting:'Waiting for user',review:'In review',done:'Done',dropped:'Dropped'};

export interface BoardRow {
 id:string;
 /** Задача одной строкой. */
 task:string;
 /** Исполнитель: id роли (nora, bolt…) или 'stas'. */
 roleId:string;
 status:BoardStatus;
 /** Тред исполнителя, если заведён. */
 threadId:string|null;
 invalidThread?:boolean;
 updatedAt:number;
 createdAt:number;
 /** Короткая заметка: что сдано, чего ждём. */
 note?:string;
 // Поля под будущие пункты, пока не заполняются плагином.
 /** Критерий готовности. */
 criteria?:string;
 /** Отметка критика: PASS или REWORK и кто ставил. */
 critic?:{verdict:'pass'|'rework';by:string;at:number}|null;
 /** Последний обход Прораба. */
 foremanAt?:number|null;
 /** Начало текущего ожидания пользователя. */
 waitingSince?:number;
 /** Сумма завершённых ожиданий пользователя в миллисекундах. */
 waitedMs?:number;
 reworks?:number;
 nudges?:number;
}

export interface BoardHandoff {from:string;to:string|null;note:string;at:number;usage:number|null}
export interface Board {
 id:string;
 projectId:string;
 title:string;
 /** Доска настоящего координатора проекта (из team.json), а не песочницы. */
 primary:boolean;
 /** Текущий тред Стаса этой доски. */
 currentThreadId:string;
 /** Все треды Стаса этой доски по сменам, старые первыми. */
 shifts:string[];
 shiftStartedAt?:Record<string,number>;
 rows:BoardRow[];
 handoff?:BoardHandoff|null;
 shiftBlockedUntil?:number;
 updatedAt:number;
}

export const SHIFT_LIMIT=6,SHIFT_WINDOW=24*60*60_000;
export const DISPATCH_LIMIT=8,DISPATCH_WINDOW=10*60_000,OPEN_ROW_LIMIT=24;
export const isOpenRow=(r:BoardRow)=>r.status!=='done'&&r.status!=='dropped';

/** Настройки диспетчера. Хранятся у треда Стаса, наследуются сменой. */
export interface DispatchConfig {
 /** Доля заполнения контекста, с которой начинается смена караула. */
 handoffAt:number;
 /** Запасной порог по числу завершённых ходов, если BB не дал заполнение. 0 = выключен. */
 handoffTurns:number;
 /** Сколько ходов смена работает до первой проверки порога: свежий тред не меняется сразу. */
 minTurns:number;
 /** Принудительные мозги исполнителей (песочница). Иначе карточка роли. */
 childExecution?:{providerId:string;model:string;reasoningLevel:string}|null;
}
export const DEFAULT_DISPATCH:DispatchConfig={handoffAt:0.6,handoffTurns:0,minTurns:3,childExecution:null};

export function mergeConfig(base:DispatchConfig,patch?:Partial<DispatchConfig>|null):DispatchConfig{
 const next={...base,...(patch??{})};
 next.handoffAt=Math.min(0.95,Math.max(0.005,Number(next.handoffAt)||DEFAULT_DISPATCH.handoffAt));
 next.handoffTurns=Math.max(0,Math.floor(Number(next.handoffTurns)||0));
 next.minTurns=Math.max(1,Math.floor(Number(next.minTurns??DEFAULT_DISPATCH.minTurns)||1));
 return next;
}

/**
 * Пора ли менять Стаса. Основной источник: заполнение контекста из `threads.context`
 * (usedTokens / modelContextWindow). Если BB его не дал, работает запасной порог по ходам.
 */
export function shiftDue(usage:{usedTokens:number|null;window:number|null}|null,turns:number,cfg:DispatchConfig):{due:boolean;ratio:number|null;why:string}{
 const ratio=usage&&usage.usedTokens!=null&&usage.window?usage.usedTokens/usage.window:null;
 if(turns<cfg.minTurns)return {due:false,ratio,why:`${turns} turns, minimum ${cfg.minTurns}`};
 if(ratio!=null&&ratio>=cfg.handoffAt)return {due:true,ratio,why:`context ${Math.round(ratio*100)}% ≥ ${Math.round(cfg.handoffAt*100)}%`};
 if(cfg.handoffTurns>0&&turns>=cfg.handoffTurns)return {due:true,ratio,why:`turns ${turns} ≥ ${cfg.handoffTurns}`};
 return {due:false,ratio,why:ratio!=null?`context ${Math.round(ratio*100)}%`:`context unknown, ${turns} turns`};
}

const one=(s:string,max=200)=>s.replace(/\s+/g,' ').trim().slice(0,max);
const time=(at:number)=>new Date(at).toISOString().slice(0,16).replace('T',' ');

/** Зеркало доски в markdown: его читает свежий Стас и вы. */
export function boardMarkdown(b:Board,names:Record<string,string>={}):string{
 const open=b.rows.filter(r=>r.status!=='done'&&r.status!=='dropped');
 const closed=b.rows.filter(r=>r.status==='done'||r.status==='dropped');
 const line=(r:BoardRow)=>`| ${r.id} | ${one(r.task,120).replace(/\|/g,'/')} | ${names[r.roleId]??r.roleId} | ${BOARD_STATUS_TEXT[r.status]} | ${r.threadId??'none'} | ${time(r.updatedAt)} |${r.note?' '+one(r.note,160).replace(/\|/g,'/'):''}`;
 const head='| id | task | assignee | status | thread | updated | note\n|---|---|---|---|---|---|---';
 return [
  `# Stas’s board: ${b.title}`,'',
  `Board ${b.id}, project ${b.projectId}. Coordinator thread ${b.currentThreadId}, shift ${b.shifts.length}. Updated ${time(b.updatedAt)} UTC.`,'',
  ...(b.handoff?['## Shift handoff',`From ${b.handoff.from}${b.handoff.to?` to ${b.handoff.to}`:''}, ${time(b.handoff.at)} UTC${b.handoff.usage!=null?`, context ${Math.round(b.handoff.usage*100)}%`:''}`,'',b.handoff.note.trim(),'']:[]),
  `## Open tasks · ${open.length}`,open.length?head+'\n'+open.map(line).join('\n'):'None.','',
  `## Closed tasks · ${closed.length}`,closed.length?head+'\n'+closed.slice(-30).map(line).join('\n'):'None.','',
 ].join('\n');
}

/** Правила диспетчера: плагин подмешивает их только тредам Стаса с включённой схемой. */
export const DISPATCHER_RULES=`Reply in the user's language

You are Stas, the Cyber Office dispatcher. Assign every task to a role, including small tasks.
0. In Claude Code, load the deferred plugin tools on your first turn with ToolSearch: select:mcp__bb-bridge__team_dispatch,mcp__bb-bridge__team_board_list,mcp__bb-bridge__team_board_add,mcp__bb-bridge__team_board_update,mcp__bb-bridge__team_handoff,mcp__bb-bridge__team_shift_accept
1. For new work, use team_dispatch with the role, title, and brief. For existing work, read team_board_list and message the assignee in their thread. Leave research, writing, and file edits to the assignee.
2. Read team_board_list before replying. Update status, thread, and a short note with team_board_update. Add threads created outside team_dispatch with team_board_add.
3. Include the goal, files, constraints, acceptance criteria, and required evidence in the brief.
4. Tell the user what you assigned, to whom, and where to follow it. Include the ::team-pass directive returned by team_dispatch for new work, or ::team-thread{id="thr_…"} for existing work. Link to the assignee's result.
5. When an assignee delivers, update the board to review or done and note what was verified.
6. When you receive a "[Cyber Office] Shift handoff" notice, call team_handoff with up to 15 lines about active work, assignees, user decisions pending, and agreements. End your turn.
7. At the start of a new shift, read the board and handoff, then call team_shift_accept. This archives the previous thread.
8. R1. Ask one question per turn with single-choice options, a default, and a deadline. Decide the rest and state assumptions.
9. R2. Check the board, files, and threads first. Ask only for a decision or access. Say where you looked.
10. R4. For Pixel, Kadr, and Rams, include a reference file and acceptance criteria in team_dispatch. Show one sample first. Produce variants after approval using the same recipe. Ask for a missing reference once before starting.
11. R6. Start each reply with an itog block using status, result, needs you, files, checked, and next. Keep result to one line and the text below the block to five lines. Put details on the board or in the next brief.
12. R3. Resolve assignee questions from the board and files if possible. Otherwise link the user to the open question with ::team-thread.
13. R5. Group manual checks in one message. Say where to click, what should appear, and which screenshot to send.`;
