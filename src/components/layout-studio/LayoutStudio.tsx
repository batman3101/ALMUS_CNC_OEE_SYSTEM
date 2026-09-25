'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Result, Select, Space, Spin, Tag, theme } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { authFetch } from '@/lib/authFetch';
import { STUDIO_MARKUP } from './studioMarkup';
import { mountLayoutStudio } from './studioEngine';
import { buildStudioView, type PlanPayload, type StudioDraft, type StudioView, type WorkspacePayload } from './planAdapter';
import './layout-studio.css';

type StudioEngine = ReturnType<typeof mountLayoutStudio>;
interface PlanListItem { id: string; status: 'draft' | 'confirmed'; title: string; target_week: string; created_at: string }
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'no_geometry'; factoryCode: string }
  | { status: 'ready'; plans: PlanListItem[]; plan: PlanPayload | null; view: StudioView };

class ApiError extends Error { constructor(readonly code: string) { super(code); } }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new ApiError(body.code ?? `http_${response.status}`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Layout Studio on real data (2026-09-25): drawing + machines from the app, a recommended plan from the
 * Forecast screen, fine-tuning saved to the server, CAPA alerts, confirm and on-site setup.
 *
 * The studio DOM is still written once and never reconciled by React: pan/zoom/pinch mutate one SVG
 * transform per pointer move (see CLAUDE.md "Layout Studio"). React owns data loading, the plan picker
 * above the map, and remounting the engine when the plan changes.
 */
export default function LayoutStudio() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const { language } = useLanguage();
  const { t } = useTranslation('forecast');
  const tRef = useRef(t);
  tRef.current = t;
  const { token } = theme.useToken();
  const router = useRouter();
  const search = useSearchParams();
  const planParam = search.get('plan');
  const lang: 'ko' | 'vi' = language === 'vi' ? 'vi' : 'ko';
  const langRef = useRef<'ko' | 'vi'>(lang);
  langRef.current = lang;

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [initialMode, setInitialMode] = useState<'draft' | 'setup'>('draft');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const revisionRef = useRef(0);
  const viewRef = useRef<StudioView | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const ws = await api<WorkspacePayload & { plans: PlanListItem[]; factory: { code: string } }>('/api/layout-planning/workspace');
      if (!ws.geometry) { setState({ status: 'no_geometry', factoryCode: ws.factory.code }); return; }
      const planId = planParam ?? ws.plans.find(p => p.status === 'draft')?.id ?? ws.plans.find(p => p.status === 'confirmed')?.id ?? null;
      const plan = planId ? await api<PlanPayload>(`/api/layout-planning/plans/${planId}`) : null;
      const view = buildStudioView(ws, plan);
      revisionRef.current = plan?.plan.revision ?? 0;
      viewRef.current = view;
      setState({ status: 'ready', plans: ws.plans, plan, view });
    } catch (error) {
      setState({ status: 'error', code: error instanceof ApiError ? error.code : 'load_failed' });
    }
  }, [planParam]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const ready = state.status === 'ready' ? state : null;
  const planId = ready?.plan?.plan.id ?? null;

  const backend = useMemo(() => {
    if (!ready) return null;
    const view = ready.view;
    const save = async (draft: StudioDraft) => {
      const changes = view.changesFor(draft);
      if (!changes.length || !planId) return;
      const body = await api<{ revision: number }>(`/api/layout-planning/plans/${planId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revisionRef.current, changes }) });
      revisionRef.current = body.revision;
      view.markSaved(draft);
    };
    return {
      readOnly: view.readOnly,
      initialMode,
      initial: view.initial,
      summarize: (draft: StudioDraft) => view.summarize(draft),
      save,
      confirm: planId && !view.readOnly ? async (draft: StudioDraft) => {
        await save(draft);
        const result = await api<{ changed_machines: number }>(`/api/layout-planning/plans/${planId}/confirm`, post({ expectedRevision: revisionRef.current }));
        return { setup: null, changed: result.changed_machines };
      } : null,
      onConfirmed: (result: { changed: number }) => {
        setNotice({ type: 'success', text: tRef.current('layoutStudio.confirmed', { count: result.changed }) });
        setInitialMode('setup');
        setReloadKey(k => k + 1);
      },
      transition: async (no: number, to: string) => {
        const ref = (viewRef.current ?? view).taskRef(no);
        if (!ref || !planId) throw new ApiError('task_not_found');
        await api(`/api/layout-planning/setup-tasks/${ref.id}/transition`, post({ expectedRevision: ref.revision, toStatus: to }));
        const [ws, plan] = await Promise.all([
          api<WorkspacePayload>('/api/layout-planning/workspace'),
          api<PlanPayload>(`/api/layout-planning/plans/${planId}`),
        ]);
        const next = buildStudioView(ws, plan);
        viewRef.current = next;
        return next.initial.setup;
      },
      // A concurrent save (409) reloads the plan. The engine's toast dies with the remount, so the reason is
      // shown above the studio instead — the user must see why their view changed.
      reload: () => { setNotice({ type: 'error', text: tRef.current('layoutStudio.conflictReloaded') }); setReloadKey(k => k + 1); },
    };
    // initialMode is read once per mount (a confirm sets it and reloads). The language must NOT be a
    // dependency: switching it would remount the engine and drop the user's view — setLang handles it live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, planId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready || !backend) return;
    root.innerHTML = STUDIO_MARKUP;
    const engine = mountLayoutStudio(root, { data: ready.view.data, lang: langRef.current, backend });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      root.replaceChildren();
    };
  }, [ready, backend]);

  useEffect(() => { engineRef.current?.setLang(lang); }, [lang]);

  async function discard() {
    if (!planId) return;
    try {
      await api(`/api/layout-planning/plans/${planId}/discard`, post({}));
      router.replace('/layout-studio');
      setReloadKey(k => k + 1);
    } catch (error) {
      setNotice({ type: 'error', text: t(`layoutStudio.errors.${error instanceof ApiError ? error.code : 'load_failed'}`, { defaultValue: t('layoutStudio.errors.load_failed') }) });
    }
  }

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
    '--ls-error-text': token.colorErrorText,
    '--ls-error-bg': token.colorErrorBg,
    '--ls-success-text': token.colorSuccessText,
    '--ls-radius': `${token.borderRadius}px`,
    '--ls-radius-lg': `${token.borderRadiusLG}px`,
  } as CSSProperties;

  if (state.status === 'no_geometry') {
    return <div data-testid="layout-no-geometry"><Result status="info" title={t('layoutStudio.noGeometryTitle')} subTitle={t('layoutStudio.noGeometry', { factory: state.factoryCode })} /></div>;
  }
  if (state.status === 'error') {
    return <Result status="warning" title={t(`layoutStudio.errors.${state.code}`, { defaultValue: t('layoutStudio.errors.load_failed') })}
      extra={<Button onClick={() => setReloadKey(k => k + 1)}>{t('layoutStudio.retry')}</Button>} />;
  }

  const planStatus = ready?.plan?.plan.status;
  return <div>
    <Space wrap className="layout-studio-planbar" style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
      <Space wrap>
        <Select<string> style={{ minWidth: 280 }} placeholder={t('layoutStudio.noPlan')} value={planId ?? undefined} loading={state.status === 'loading'}
          data-testid="plan-select"
          options={(ready?.plans ?? []).map(p => ({ value: p.id, label: `${p.title} · ${t(`layoutStudio.status.${p.status}`)}` }))}
          onChange={id => { setInitialMode('draft'); router.replace(`/layout-studio?plan=${id}`); }} />
        {planStatus && <Tag color={planStatus === 'draft' ? 'blue' : planStatus === 'confirmed' ? 'green' : 'default'}>{t(`layoutStudio.status.${planStatus}`)}</Tag>}
      </Space>
      <Space wrap>
        {planStatus === 'draft' && <Button danger onClick={discard} data-testid="discard-plan">{t('layoutStudio.discard')}</Button>}
        <Link href="/forecast"><Button type={ready?.plan ? 'default' : 'primary'}>{t('layoutStudio.newPlan')}</Button></Link>
      </Space>
    </Space>
    {ready && !ready.plan && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('layoutStudio.noPlanHelp')} />}
    {notice && <Alert type={notice.type} showIcon closable onClose={() => setNotice(null)} style={{ marginBottom: 12 }} message={notice.text} data-testid="studio-notice" />}
    {state.status === 'loading' && <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>}
    <div ref={rootRef} className="layout-studio" style={themeVars} hidden={state.status !== 'ready'} />
  </div>;
}
