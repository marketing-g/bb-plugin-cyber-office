// Поле с микрофоном BB: тот же сервис распознавания и настройки, что у нижнего поля.
// Расшифровка дописывается в value и сама не отправляется. Если голос в этой версии BB
// пропал или упал при отрисовке, остаётся обычное поле.
import {Component,type ReactNode} from 'react';
import {experimental_VoiceInputTextarea} from '@get-bb/plugin-sdk/app';
import {PlainField,type FieldProps} from './field';

class VoiceBoundary extends Component<{fallback:ReactNode;children?:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:unknown){console.warn('[cyber-office] голосовое поле отключено',e);}
 render(){return this.state.failed?this.props.fallback:this.props.children;}
}

export function VoiceField(p:FieldProps){
 const Voice=experimental_VoiceInputTextarea as typeof experimental_VoiceInputTextarea|undefined;
 const plain=<PlainField {...p}/>;
 if(!Voice)return plain;
 const {className,...rest}=p;
 return <VoiceBoundary fallback={plain}><Voice {...rest} className={(className??'')+' km-voice'}/></VoiceBoundary>;
}
