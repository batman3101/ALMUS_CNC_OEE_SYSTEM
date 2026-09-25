'use client';

import { useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import layoutData from './layoutData.json';
import { STUDIO_MARKUP } from './studioMarkup';
import { mountLayoutStudio } from './studioEngine';
import './layout-studio.css';

type StudioEngine = ReturnType<typeof mountLayoutStudio>;

/**
 * React shell around the Layout Studio preview engine.
 *
 * The studio DOM is written once, imperatively, and React never reconciles it. That is the point:
 * pan/zoom/pinch mutate one SVG transform per pointer move, and routing those moves through React
 * state would re-render 800 machines per frame. React owns only mount/unmount and the language.
 */
export default function LayoutStudio() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const { language } = useLanguage();
  const lang: 'ko' | 'vi' = language === 'vi' ? 'vi' : 'ko';
  const langRef = useRef<'ko' | 'vi'>(lang);
  langRef.current = lang;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = STUDIO_MARKUP;
    const engine = mountLayoutStudio(root, { data: layoutData, lang: langRef.current });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      root.replaceChildren();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setLang(lang);
  }, [lang]);

  return <div ref={rootRef} className="layout-studio" />;
}
