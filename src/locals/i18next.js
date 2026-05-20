import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';
import te from './te.json';

export const languageResources ={
    en : {translation : en},
    hi : {translation : hi},
    te : {translation : te},

};


  i18next.use(initReactI18next).init({
    fallbackLng: 'en',
    debug: true,
    lng : 'en',
    resources : languageResources
  });

  export default i18next;

