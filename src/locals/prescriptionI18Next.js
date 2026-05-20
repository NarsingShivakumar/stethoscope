import i18next from 'i18next';
import en_pre from './en_pre.json';
import hi_pre from './hi_pre.json';
import te_pre from './te_pre.json';

export const prescriptionResources = {
  en: { translation: en_pre },
  hi: { translation: hi_pre },
  te: { translation: te_pre },
};

const prescriptionI18Next = i18next.createInstance();

prescriptionI18Next.init({
  fallbackLng: 'en',
  debug: true,
  lng: 'en', // Default language for prescription
  resources: prescriptionResources,
});

export default prescriptionI18Next;
