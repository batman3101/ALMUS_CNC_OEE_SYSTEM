'use client';

import { useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import type { FactoryForecastPreview } from '@/types/forecast';
import { groupWeeks, weeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { matchModels, normalizeProcessName } from '@/lib/forecast/modelAliases';
import { buildRequirements, type ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import { proposeReassignment, type ReassignmentMove } from '@/lib/forecast/reassignment';
import styles from './ForecastWorkspace.module.css';

/** Problems first, then things the reviewer may act on, then the quiet rows. */
const STATUS_RANK: Record<ModelProcessRequirement['status'], number> = { shortage: 0, unmapped: 1, no_tact: 2, surplus: 3, zero_demand: 4, not_in_forecast: 5, ok: 6 };
const STATUS_COLOR: Record<ModelProcessRequirement['status'], string> = { shortage: 'red', unmapped: 'orange', no_tact: 'orange', surplus: 'blue', zero_demand: 'default', not_in_forecast: 'default', ok: 'green' };

/** NULL ("not computable") sorts last in both directions — it is not a small number. */
const nullable = (pick: (r: ModelProcessRequirement) => number | null) => (a: ModelProcessRequirement, b: ModelProcessRequirement, order?: 'ascend' | 'descend' | null) => {
  const [x, y] = [pick(a), pick(b)];
  if (x === null && y === null) return 0;
  if (x === null) return order === 'descend' ? -1 : 1;
  if (y === null) return order === 'descend' ? 1 : -1;
  return x - y;
};

export default function WeeklySimulationCard({ preview }: { preview: FactoryForecastPreview }) {
  const { t, language } = useTranslation('forecast');
  const locale = language === 'vi' ? 'vi-VN' : 'ko-KR';
  const weeks = useMemo(() => groupWeeks(preview.dates), [preview.dates]);
  const [weekKey, setWeekKey] = useState(weeks[0]?.key ?? '');
  const weekIndex = Math.max(0, weeks.findIndex(w => w.key === weekKey));
  const week = weeks[weekIndex];
  const snapshot = preview.capacitySnapshot;
  const policy = preview.capacityPolicy;
  const numberFormat = new Intl.NumberFormat(locale);

  const result = useMemo(() => {
    if (!week || snapshot?.status !== 'available' || policy.status !== 'available') return null;
    const demands = weeklyModelDemand(preview.rows, week);
    const nextWeek = weeks[weekIndex + 1];
    const nextWeekDemands = nextWeek ? weeklyModelDemand(preview.rows, nextWeek) : [];
    const matches = matchModels(demands.map(d => d.model), snapshot.models);
    const requirements = buildRequirements({ demands, matches, models: snapshot.models, machines: snapshot.machines, breakMinutes: policy.breakMinutes })
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.gap ?? 0) - (a.gap ?? 0) || (a.forecastModel ?? a.dbModel?.name ?? '').localeCompare(b.forecastModel ?? b.dbModel?.name ?? ''));
    const proposal = proposeReassignment({ requirements, machines: snapshot.machines, nextWeekDemands });
    const unmapped = [...matches.values()].filter(m => !m.dbModel).map(m => m.forecastModel);
    const forecastProcessIds = new Set(snapshot.models.flatMap(m => m.processes.filter(p => normalizeProcessName(p.name)).map(p => p.id)));
    const active = snapshot.machines.filter(m => m.isActive);
    const unassigned = active.filter(m => !m.modelId || !m.processId).length;
    const excluded = active.filter(m => m.modelId && m.processId && !forecastProcessIds.has(m.processId)).length;
    return { requirements, proposal, unmapped, unassigned, excluded };
  }, [preview.rows, week, weeks, weekIndex, snapshot, policy]);

  const columns: ColumnsType<ModelProcessRequirement> = [
    { title: t('simulation.model'), key: 'model', width: 190, sorter: (a, b) => (a.forecastModel ?? '').localeCompare(b.forecastModel ?? ''), render: (_, r) => <><strong>{r.forecastModel ?? '—'}</strong><div className={styles.secondary}>{r.dbModel?.name ?? t('simulation.statuses.unmapped')}</div></> },
    { title: t('simulation.process'), dataIndex: 'process', width: 80, sorter: (a, b) => a.process.localeCompare(b.process) },
    { title: t('simulation.peak'), key: 'peak', width: 150, sorter: (a, b) => a.peakQuantity - b.peakQuantity, render: (_, r) => <>{numberFormat.format(r.peakQuantity)}{r.peakDate && <div className={styles.secondary}>{r.peakDate}</div>}</> },
    { title: t('simulation.capacity'), key: 'capacity', width: 120, sorter: nullable(r => r.dailyCapacity), render: (_, r) => r.dailyCapacity === null ? '—' : numberFormat.format(r.dailyCapacity) },
    { title: t('simulation.required'), key: 'required', width: 100, sorter: nullable(r => r.required), render: (_, r) => r.required === null ? '—' : r.required },
    { title: t('simulation.current'), dataIndex: 'current', width: 100, sorter: (a, b) => a.current - b.current },
    { title: t('simulation.gap'), key: 'gap', width: 90, sorter: nullable(r => r.gap), render: (_, r) => r.gap === null ? '—' : r.gap > 0 ? `+${r.gap}` : String(r.gap) },
    { title: t('simulation.status'), key: 'status', sorter: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status], render: (_, r) => <Space wrap><Tag color={STATUS_COLOR[r.status]}>{t(`simulation.statuses.${r.status}`)}</Tag>{r.warnings.map(w => <Tag color="orange" key={w}>{t(`simulation.warnings.${w}`)}</Tag>)}</Space> },
  ];
  const moveColumns: ColumnsType<ReassignmentMove> = [
    { title: t('simulation.machine'), dataIndex: 'machineName', width: 110 },
    { title: t('simulation.location'), dataIndex: 'location', width: 90 },
    { title: t('simulation.fromTo'), key: 'fromTo', render: (_, m) => <>{m.from.model ? `${m.from.model} / ${m.from.process}` : '—'} → <strong>{m.to.model} / {m.to.process}</strong></> },
    { title: t('simulation.reason'), key: 'reason', render: (_, m) => <Space wrap><Tag>{t(`simulation.reasons.${m.reason}`)}</Tag>{m.nextWeekDemand && <Tag color="orange">{t('simulation.nextWeekDemand')}</Tag>}</Space> },
  ];

  return <Card title={t('simulation.title')}>
    <Space direction="vertical" className={styles.fullWidth} size="middle">
      <Alert type="warning" showIcon message={t('simulation.notice')} />
      <div className={styles.filters}>
        <label data-testid="week-select">{t('simulation.week')}
          <Select value={weekKey} onChange={setWeekKey} className={styles.weekSelect} options={weeks.map(w => ({ value: w.key, label: `${w.label} · ${w.start.slice(5)}~${w.end.slice(5)}${w.partial ? ` (${t('simulation.partial')})` : ''}` }))} />
        </label>
      </div>
      {snapshot?.status !== 'available' && <Alert type="warning" message={t('simulation.snapshotUnavailable')} />}
      {snapshot?.status === 'available' && policy.status !== 'available' && <Alert type="warning" message={t('simulation.policyUnavailable')} />}
      {result && snapshot?.status === 'available' && policy.status === 'available' && <>
        <Typography.Text type="secondary">{t('simulation.snapshotTaken', { time: new Date(snapshot.takenAt).toLocaleString(locale), rest: policy.breakMinutes })}</Typography.Text>
        <Row gutter={[16, 16]} className={styles.statistics}>
          <Col xs={12} md={6}><Statistic title={t('simulation.required')} value={result.proposal.summary.required} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.current')} value={result.proposal.summary.current} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.shortage')} value={result.proposal.summary.shortage} valueStyle={result.proposal.summary.shortage ? { color: '#cf1322' } : undefined} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.changes')} value={result.proposal.summary.changes} /></Col>
        </Row>
        <div data-testid="requirements-table">
          <Table<ModelProcessRequirement> size="small" columns={columns} dataSource={result.requirements} rowKey="key" scroll={{ x: 900 }} pagination={{ pageSize: 20, showSizeChanger: true }} />
        </div>
        <Typography.Title level={5}>{t('simulation.movesTitle')}</Typography.Title>
        {result.proposal.moves.length
          ? <div data-testid="moves-table"><Table<ReassignmentMove> size="small" columns={moveColumns} dataSource={result.proposal.moves} rowKey="machineId" scroll={{ x: 600 }} pagination={{ pageSize: 20, showSizeChanger: true }} /></div>
          : <Typography.Text type="secondary">{t('simulation.noMoves')}</Typography.Text>}
        {result.proposal.unresolved.length > 0 && <Alert type="error" showIcon message={t('simulation.unresolved', { list: result.proposal.unresolved.map(u => `${u.dbModel} ${u.process} ${u.remaining}`).join(', ') })} />}
        {result.unmapped.length > 0 && <div><Typography.Text strong>{t('simulation.unmappedTitle', { count: result.unmapped.length })}</Typography.Text><div className={styles.tagList}>{result.unmapped.map(m => <Tag key={m}>{m}</Tag>)}</div></div>}
        <Typography.Text type="secondary">{t('simulation.excludedMachines', { count: result.excluded })} · {t('simulation.unassignedMachines', { count: result.unassigned })}</Typography.Text>
      </>}
    </Space>
  </Card>;
}
