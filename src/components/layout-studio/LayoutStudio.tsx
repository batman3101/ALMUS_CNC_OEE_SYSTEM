'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { theme } from 'antd';
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
  const { token } = theme.useToken();
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

  // App theme → studio CSS variables. The chrome follows the app (colour, dark mode); the map itself
  // (#stage) stays light on purpose — decided 2026-09-25 so the model colours stay readable.
  const themeVars = {
    '--ls-font': token.fontFamily,
    '--ls-primary': token.colorPrimary,
    '--ls-primary-hover': token.colorPrimaryHover,
    '--ls-primary-bg': token.colorPrimaryBg,
    '--ls-primary-border': token.colorPrimaryBorder,
    '--ls-text': token.colorText,
    '--ls-text-heading': token.colorTextHeading,
    '--ls-text-secondary': token.colorTextSecondary,
    '--ls-text-tertiary': token.colorTextTertiary,
    '--ls-text-disabled': token.colorTextDisabled,
    '--ls-bg': token.colorBgContainer,
    '--ls-bg-elevated': token.colorBgElevated,
    '--ls-bg-disabled': token.colorBgContainerDisabled,
    '--ls-fill-alter': token.colorFillAlter,
    '--ls-fill-secondary': token.colorFillSecondary,
    '--ls-border': token.colorBorder,
    '--ls-border-secondary': token.colorBorderSecondary,
    '--ls-info-bg': token.colorInfoBg,
    '--ls-info-border': token.colorInfoBorder,
    '--ls-warning-text': token.colorWarningText,
    '--ls-radius': `${token.borderRadius}px`,
    '--ls-radius-lg': `${token.borderRadiusLG}px`,
  } as CSSProperties;

  return <div ref={rootRef} className="layout-studio" style={themeVars} />;
}
