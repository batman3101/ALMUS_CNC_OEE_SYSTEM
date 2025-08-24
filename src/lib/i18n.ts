import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 번역 리소스 import
import koCommon from '../../public/locales/ko/common.json';
import viCommon from '../../public/locales/vi/common.json';
import koMachines from '../../public/locales/ko/machines.json';
import viMachines from '../../public/locales/vi/machines.json';
import koDashboard from '../../public/locales/ko/dashboard.json';
import viDashboard from '../../public/locales/vi/dashboard.json';
import koAuth from '../../public/locales/ko/auth.json';
import viAuth from '../../public/locales/vi/auth.json';
import koAdmin from '../../public/locales/ko/admin.json';
import viAdmin from '../../public/locales/vi/admin.json';
import koProduction from '../../public/locales/ko/production.json';
import viProduction from '../../public/locales/vi/production.json';

const resources = {
  ko: {
    common: koCommon,
    machines: koMachines,
    dashboard: koDashboard,
    auth: koAuth,
    admin: koAdmin,
    production: koProduction,
  },
  vi: {
    common: viCommon,
    machines: viMachines,
    dashboard: viDashboard,
    auth: viAuth,
    admin: viAdmin,
    production: viProduction,
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ko', // 기본 언어
    fallbackLng: 'ko',
    
    // 네임스페이스 설정
    defaultNS: 'common',
    ns: ['common', 'machines', 'dashboard', 'auth', 'admin', 'production'],
    
    interpolation: {
      escapeValue: false, // React는 기본적으로 XSS 보호
    },
    
    // 개발 모드에서 디버깅 정보 표시
    debug: process.env.NODE_ENV === 'development',
  });

export default i18n;