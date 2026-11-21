import {createContext, useContext, useMemo} from 'react';
import {DEFAULT_LANGUAGE, translator, type Language} from './i18n.ts';

export const OfficeLanguage = createContext<Language>(DEFAULT_LANGUAGE);
export const useLanguage = () => useContext(OfficeLanguage);
export function useText(){const lang=useLanguage();return useMemo(()=>translator(lang),[lang]);}
