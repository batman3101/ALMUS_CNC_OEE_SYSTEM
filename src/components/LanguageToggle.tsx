'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/Button';

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={language === 'ko' ? 'default' : 'outline'}
        size="sm"
        onClick={() => setLanguage('ko')}
      >
        한국어
      </Button>
      <Button
        variant={language === 'vi' ? 'default' : 'outline'}
        size="sm"
        onClick={() => setLanguage('vi')}
      >
        Tiếng Việt
      </Button>
    </div>
  );
}