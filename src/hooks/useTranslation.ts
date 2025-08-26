import { useTranslation as useI18nTranslation } from 'react-i18next';

// 네임스페이스별 번역 훅
export const useTranslation = (namespace?: string) => {
  const { t, i18n } = useI18nTranslation(namespace);
  
  return {
    t,
    i18n,
    language: i18n.language as 'ko' | 'vi',
    changeLanguage: (lang: 'ko' | 'vi') => i18n.changeLanguage(lang),
  };
};

// 특정 네임스페이스용 훅들
export const useCommonTranslation = () => useTranslation('common');
export const useMachinesTranslation = () => useTranslation('machines');
export const useDashboardTranslation = () => useTranslation('dashboard');
export const useAuthTranslation = () => useTranslation('auth');
export const useAdminTranslation = () => useTranslation('admin');
export const useProductionTranslation = () => useTranslation('production');
export const useModelInfoTranslation = () => useTranslation('modelInfo');
export const useReportsTranslation = () => useTranslation('common');

// 다중 네임스페이스 지원 훅
export const useMultipleTranslation = (namespaces: string[]) => {
  const { t, i18n } = useI18nTranslation(namespaces);
  
  return {
    t,
    i18n,
    language: i18n.language as 'ko' | 'vi',
    changeLanguage: (lang: 'ko' | 'vi') => i18n.changeLanguage(lang),
  };
};