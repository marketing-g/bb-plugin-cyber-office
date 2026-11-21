// Общий контракт формы и чистые функции. Время берётся на компьютере сервера BB.
import {z} from 'zod';
import {DEFAULT_LANGUAGE,text,translator} from './i18n.ts';
import {isAbsoluteLocalPath} from './local-path.ts';

export const ASK_FORM_ID='team-ask-form';
export const ASK_TIMEOUT_MS=6*60*60*1000;

const IMAGE_EXTENSION=/\.(?:png|jpe?g|webp|gif)$/i;
/** An option picture: a local image file only, so the form never links to a program or a document. */
export function absoluteImagePath(path:string):boolean{
 return isAbsoluteLocalPath(path)
  &&!/[\u0000-\u001f]/.test(path)&&!path.split(/[\\/]/).includes('..')
  &&IMAGE_EXTENSION.test(path)&&!path.slice(2).includes(':');
}
const line=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/[\r\n]/.test(v),text('ask_single_line'));
export const askParameters=z.object({
 question:line(1000).describe('One question for the user'),
 options:z.array(z.object({id:line(80),label:line(60),image:z.string().min(1).max(2000).refine(absoluteImagePath,text('ask_image_path')).optional()}).strict()).min(2).max(4),
 defaultId:line(80).describe('Required default option ID from options'),
 deadline:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().describe('Today at HH:MM on the BB computer. A past deadline immediately selects defaultId.'),
 context:line(500).optional().describe('One line on where you looked for the answer under R2'),
}).strict();
export type AskInput=z.infer<typeof askParameters>;
export interface AskWindow {expiresAt:number;deadlineLabel:string}
export type AskPayload=AskInput&AskWindow;
export interface AskAnswer {answer:string|null;text:string;by:'click'|'own'|'default'}
export type AskSubmission={by:'click';answer:string}|{by:'own';text:string};

export function parseAsk(value:unknown,lang=DEFAULT_LANGUAGE):AskInput{
 const input=askParameters.parse(value);
 if(new Set(input.options.map(o=>o.id)).size!==input.options.length)throw new Error(translator(lang)('ask_distinct_options'));
 if(!input.options.some(o=>o.id===input.defaultId))throw new Error(translator(lang)('ask_default_missing'));
 return input;
}

/** HH:MM относится к сегодняшнему дню, прошедшее время не переносим на завтра. */
export function askWindow(input:Pick<AskInput,'deadline'>,now:number):AskWindow{
 const end=new Date(now);
 if(input.deadline){const [h,m]=input.deadline.split(':').map(Number);end.setHours(h,m,0,0);}
 else end.setTime(now+ASK_TIMEOUT_MS);
 const deadlineLabel=input.deadline??`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`;
 return {expiresAt:end.getTime(),deadlineLabel};
}
export function defaultAskAnswer(input:AskInput,window:AskWindow):AskAnswer{
 return {answer:input.defaultId,text:`No answer by ${window.deadlineLabel}. Use the default option.`,by:'default'};
}
const submission=z.discriminatedUnion('by',[
 z.object({by:z.literal('click'),answer:z.string()}).strict(),
 z.object({by:z.literal('own'),text:z.string().trim().min(1).max(4000)}).strict(),
]);
/** Подпись клика берём из исходного вопроса, не доверяем тексту из браузера. */
export function resolveAskAnswer(input:AskInput,window:AskWindow,value:unknown,now:number):AskAnswer{
 if(now>=window.expiresAt)return defaultAskAnswer(input,window);
 const result=submission.parse(value);
 if(result.by==='own')return {answer:null,text:result.text,by:'own'};
 const option=input.options.find(o=>o.id===result.answer);
 if(!option)throw new Error(text('ask_option_missing'));
 return {answer:option.id,text:option.label,by:'click'};
}
