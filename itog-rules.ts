// Правила формата ответа для агентов команды. Сервер плагина вызывает registerItogRules(bb, …):
// текст уходит в инструкции новых тредов через bb.agents.contributeInstructions.
// Живые сессии получают правила только после нового старта сессии (так устроен SDK).
import type {BbPluginApi} from '@get-bb/plugin-sdk';

export const REPLY_LANGUAGE = "Reply in the user's language";

export const ITOG_RULES=`${REPLY_LANGUAGE}

Cyber Office response format
Start each reply to the user with an itog code block. Use these English keys, one field per line:
status: done | partial | question | blocker | working
result: one line describing the outcome
needs you: one bullet per question with options separated by " | ". Put the default first and give a deadline. Use "nothing" if no input is needed.
files: absolute file paths, one bullet per line
checked: how you verified it, with a file, check, or fact
next: the next step and who owns it
You may omit files, checked, and next. Example:
\`\`\`itog
status: question
result: Drafted three headlines for the demo.
needs you:
- Which headline should we use? If there is no answer by 21:00, use option 2. | 2 | 1 | 3
files:
- /project/example.md
next: Pixel adds the headline to the design.
\`\`\`
Keep the reply under the block to five lines. Put extra detail in a file or hand it off to the relevant role. Use at most three columns in tables.`;

export const DESIGN_RULES=`R4. Work from an approved reference. Record the reference file and acceptance criteria before generating. Ask the coordinator if either is missing. Show one sample for user approval before producing variants. Record the generator, scene, prompt, and layout in a manifest and keep them consistent between batches. Share rejected work and the reasons with the critic.`;

export const ROLE_RULES=`Cyber Office role rules
R1. Ask at most one question per turn. Each option should be a single choice. Include a default and a deadline, such as "If there is no answer by 21:00, I will use option A." Decide the rest and state assumptions. Use team_ask when available and omit the question from the result block.
R2. Check project files and thread history first. Ask the user only for a decision or access. Say where you already looked.
${DESIGN_RULES}
R5. Group all manual checks into one message. Say where to click, what should appear, and which screenshot to send.
R6. Keep result to one line. Put detail in a file or share it with the relevant role.`;

export const TEAM_RULES=ITOG_RULES+'\n\n'+ROLE_RULES;

export const ITOG_ASK_PROMPT=REPLY_LANGUAGE+'\n\nSummarize this reply in an itog block with status, a one-line result, needs you (a single question with a default or nothing), and files. Put extra detail in a file and keep the text below the block to five lines.';

export const ITOG_RULES_EXCLUDE:readonly string[]=[];
const TEST_TITLE=/^\s*(?:тест|test)\s*:/i;

export interface ItogRulesOptions{
 /** Проекты команды, обычно Object.keys(team.json coordinatorByProject). Функцией, если список меняется. */
 projectIds?:readonly string[]|(()=>readonly string[]);
 /** Id тредов без правил. По умолчанию ITOG_RULES_EXCLUDE. */
 excludeIds?:readonly string[];
 /** Синхронный заголовок треда из памяти сервера, чтобы пропустить треды «Тест:». Новый тред без заголовка правила получает. */
 titleOf?:(threadId:string)=>string|null|undefined;
}

/** Правила для треда или null. Синхронно и быстро: провайдер стоит на пути старта треда. */
export function itogRulesFor(ctx:{threadId:string;projectId:string},opts:ItogRulesOptions):string|null{
 const projects=typeof opts.projectIds==='function'?opts.projectIds():opts.projectIds;
 if(projects&&!projects.includes(ctx.projectId))return null;
 if((opts.excludeIds??ITOG_RULES_EXCLUDE).includes(ctx.threadId))return null;
 const title=opts.titleOf?.(ctx.threadId);
 if(title&&TEST_TITLE.test(title))return null;
 return TEAM_RULES;
}

/** Регистрирует правила. contributeInstructions можно звать один раз на плагин: если сервер уже даёт свои инструкции, склейте текст и вызывайте itogRulesFor. */
export function registerItogRules(bb:Pick<BbPluginApi,'agents'>,opts:ItogRulesOptions){
 bb.agents.contributeInstructions(ctx=>{try{return itogRulesFor(ctx,opts);}catch{return null;}});
}
