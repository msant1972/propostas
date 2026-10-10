import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptPT from './pt-PT.json';

void i18n.use(initReactI18next).init({
  lng: 'pt-PT',
  fallbackLng: 'pt-PT',
  resources: { 'pt-PT': { translation: ptPT } },
  interpolation: { escapeValue: false },
});

export default i18n;
