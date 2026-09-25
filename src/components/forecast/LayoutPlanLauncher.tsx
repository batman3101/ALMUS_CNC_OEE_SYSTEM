'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import { authFetch } from '@/lib/authFetch';
import { matchModels, normalizeModelName } from '@/lib/forecast/modelAliases';
import type { ForecastWeek, WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import type { FactoryForecastPreview, ForecastSnapshotModel } from '@/types/forecast';

interface MappingRow { forecastModel: string; peak: number; source: 'saved' | 'auto' | 'unmapped'; productModelId: string | null; blocking: boolean }
interface SavedMapping { forecastModelKey: string; productModelId: string }

/**
 * Forecast week → recommended Layout plan (requirements 1–3), plus the model-name pairing step
 * (decision 2026-09-25: the field abbreviates model names, so the user confirms pairings here and they are
 * reused for later forecasts of this factory).
 */
export default function LayoutPlanLauncher({ preview, week, demands, nextWeekDemands }: {
  preview: FactoryForecastPreview; week: ForecastWeek; demands: WeeklyModelDemand[]; nextWeekDemands: WeeklyModelDemand[];
}) {
  const { t } = useTranslation('forecast');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<MappingRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const models = useMemo<ForecastSnapshotModel[]>(
    () => preview.capacitySnapshot.status === 'available' ? preview.capacitySnapshot.models.filter(m => m.isActive) : [],
    [preview.capacitySnapshot],
  );
  const withDemand = demands.filter(d => d.peakQuantity > 0);

  async function openMappings(blocking: string[] = []) {
    setError('');
    const response = await authFetch('/api/layout-planning/model-mappings');
    const body = await response.json();
    if (!response.ok || !body.success) { setError(body.code ?? 'mapping_load_failed'); return; }
    const saved = new Map((body.mappings as SavedMapping[]).map(m => [m.forecastModelKey, m.productModelId]));
    const auto = matchModels(withDemand.map(d => d.model), models);
    setRows(withDemand.map((d): MappingRow => {
      const savedId = saved.get(normalizeModelName(d.model));
      const autoId = auto.get(d.model)?.dbModel?.id ?? null;
      return {
        forecastModel: d.model, peak: d.peakQuantity,
        source: savedId ? 'saved' : autoId ? 'auto' : 'unmapped',
        productModelId: savedId ?? autoId, blocking: blocking.includes(d.model),
      };
    }).sort((a, b) => Number(b.blocking) - Number(a.blocking) || Number(a.source !== 'unmapped') - Number(b.source !== 'unmapped') || a.forecastModel.localeCompare(b.forecastModel)));
  }

  async function saveMappings() {
    if (!rows) return;
    setSaving(true);
    try {
      const items = rows.filter(r => r.productModelId).map(r => ({ forecastModel: r.forecastModel, productModelId: r.productModelId }));
      const response = await authFetch('/api/layout-planning/model-mappings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const body = await response.json();
      if (!response.ok || !body.success) { setError(body.code ?? 'mapping_save_failed'); return; }
      setRows(null);
      await createPlan(false);
    } finally { setSaving(false); }
  }

  async function createPlan(acknowledgeUnmapped: boolean) {
    setBusy(true); setError('');
    try {
      const response = await authFetch('/api/layout-planning/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${week.label} · ${preview.fileName}`, forecastFileName: preview.fileName, forecastFileHash: preview.sourceHash,
          week: { key: week.key, start: week.start, end: week.end }, demands, nextWeekDemands, acknowledgeUnmapped,
        }),
      });
      const body = await response.json();
      if (response.status === 422 && body.code === 'unmapped_models') { await openMappings(body.detail?.models ?? []); return; }
      if (!response.ok || !body.success) { setError(body.code ?? 'plan_failed'); return; }
      router.push(`/layout-studio?plan=${body.planId}`);
    } catch { setError('plan_failed'); } finally { setBusy(false); }
  }

  const blockingLeft = rows?.some(r => r.blocking && !r.productModelId) ?? false;
  const columns: ColumnsType<MappingRow> = [
    { title: t('layoutPlan.forecastModel'), key: 'fm', render: (_, r) => <><strong>{r.forecastModel}</strong>{r.blocking && !r.productModelId && <Tag color="red" style={{ marginLeft: 8 }}>{t('layoutPlan.required')}</Tag>}</> },
    { title: t('layoutPlan.peak'), dataIndex: 'peak', width: 110 },
    { title: t('layoutPlan.appModel'), key: 'app', width: 260, render: (_, r) => (
      <Select showSearch allowClear placeholder={t('layoutPlan.pick')} style={{ width: '100%' }} value={r.productModelId ?? undefined}
        optionFilterProp="label" options={models.map(m => ({ value: m.id, label: m.name }))}
        onChange={value => setRows(prev => prev?.map(x => x.forecastModel === r.forecastModel ? { ...x, productModelId: value ?? null, source: value ? x.source : 'unmapped' } : x) ?? null)} />
    ) },
    { title: t('layoutPlan.source'), key: 'src', width: 110, render: (_, r) => <Tag color={r.source === 'saved' ? 'green' : r.source === 'auto' ? 'blue' : 'default'}>{t(`layoutPlan.sources.${r.source}`)}</Tag> },
  ];

  return <Space direction="vertical" style={{ width: '100%' }}>
    <Space wrap>
      <Button type="primary" loading={busy} disabled={!withDemand.length || !models.length} onClick={() => createPlan(false)} data-testid="create-layout-plan">
        {t('layoutPlan.create')}
      </Button>
      <Button onClick={() => openMappings()} disabled={!withDemand.length || !models.length} data-testid="open-model-mappings">{t('layoutPlan.mappings')}</Button>
    </Space>
    <Typography.Text type="secondary">{t('layoutPlan.hint')}</Typography.Text>
    {error && <Alert type="error" showIcon message={t(`layoutPlan.errors.${error}`, { defaultValue: t('layoutPlan.errors.plan_failed') })} />}
    <Modal open={!!rows} width={760} title={t('layoutPlan.mappingsTitle')} onCancel={() => setRows(null)} destroyOnHidden
      footer={[
        <Button key="cancel" onClick={() => setRows(null)}>{t('layoutPlan.cancel')}</Button>,
        <Button key="skip" danger disabled={!rows?.some(r => r.blocking)} onClick={() => { setRows(null); createPlan(true); }}>{t('layoutPlan.skipUnmapped')}</Button>,
        <Button key="save" type="primary" loading={saving} disabled={blockingLeft} onClick={saveMappings} data-testid="save-model-mappings">{t('layoutPlan.saveAndCreate')}</Button>,
      ]}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={t('layoutPlan.mappingsHelp')} />
        <Table<MappingRow> size="small" rowKey="forecastModel" columns={columns} dataSource={rows ?? []} pagination={{ pageSize: 10 }} />
      </Space>
    </Modal>
  </Space>;
}
