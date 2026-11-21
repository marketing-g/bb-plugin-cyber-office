// Поле ввода без SDK: пульт Стаса и «Свой ответ» в итоге рисуют его в офлайн-превью.
// В BB вместо него приходит VoiceField (voice-field.tsx) с микрофоном BB.
import type {ComponentType,KeyboardEvent} from 'react';

export interface FieldProps{
 id?:string;
 value:string;
 onValueChange:(value:string)=>void;
 /** true с начала записи голоса до конца расшифровки: отправку держать. */
 onVoiceInputActiveChange?:(active:boolean)=>void;
 placeholder?:string;
 rows?:number;
 className?:string;
 disabled?:boolean;
 autoFocus?:boolean;
 'aria-label'?:string;
 onKeyDown?:(e:KeyboardEvent<HTMLTextAreaElement>)=>void;
}
export type FieldComponent=ComponentType<FieldProps>;

export function PlainField({onValueChange,onVoiceInputActiveChange:_voice,...rest}:FieldProps){
 return <textarea {...rest} onChange={e=>onValueChange(e.target.value)}/>;
}
