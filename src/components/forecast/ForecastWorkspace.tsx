'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import { useFactory } from '@/contexts/FactoryContext';
import { authFetch } from '@/lib/authFetch';
import type { FactoryForecastPreview, ForecastQuantity, ForecastSourceRow } from '@/types/forecast';
import WeeklySimulationCard from './WeeklySimulationCard';
import styles from './ForecastWorkspace.module.css';

const MAX_BYTES = 4 * 1024 * 1024;

export default function ForecastWorkspace() {
  const { t, language } = useTranslation('forecast');
  const { factoryId, factoryCode } = useFactory();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FactoryForecastPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const currentFactory = useRef(factoryId);
  currentFactory.current = factoryId;

  useEffect(() => {
    setPreview(null); setFile(null); setError(''); setLoading(false);
    requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [factoryId]);

  const visiblePreview = preview?.factory.id === factoryId ? preview : null;
  const selectedRows = useMemo(() => (visiblePreview?.rows ?? []).map(row => ({
    ...row, quantities: row.quantities.filter(q => (!start || q.date >= start) && (!end || q.date <= end)),
  })), [visiblePreview, start, end]);
  const problem = (q: ForecastQuantity) => q.state !== 'number' || (q.quantity !== null && !Number.isInteger(q.quantity));
  const quantities = selectedRows.flatMap(row => row.quantities);
  const numberFormat = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'ko-KR', { maximumFractionDigits: 10 });

  async function inspect() {
    if (!file || !factoryId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const expectedFactory = factoryId;
    setLoading(true); setPreview(null); setError('');
    try {
      const response = await authFetch('/api/forecasts/preview', {
        method: 'POST', body: file, signal: controller.signal,
        headers: { 'Content-Type': 'application/octet-stream', 'x-forecast-file-name': encodeURIComponent(file.name), 'x-forecast-factory-id': expectedFactory },
      });
      const result = await response.json();
      if (controller.signal.aborted || currentFactory.current !== expectedFactory) return;
      if (!response.ok || !result.success) {
        setError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : (typeof result.code === 'string' ? result.code : 'preview_failed'));
        return;
      }
      if (result.preview?.factory?.id !== expectedFactory) { setError('factory_changed'); return; }
      const received: FactoryForecastPreview = result.preview;
      setPreview(received); setStart(received.dates[0]); setEnd(received.dates[received.dates.length - 1]); setIssuesOnly(false);
    } catch {
      if (!controller.signal.aborted && currentFactory.current === expectedFactory) setError('preview_failed');
    } finally { if (requestRef.current === controller && !controller.signal.aborted) setLoading(false); }
  }

  const quantityColumns: ColumnsType<ForecastQuantity> = [
    { title: t('date'), dataIndex: 'date', width: 120 },
    { title: t('cell'), dataIndex: 'cell', width: 90 },
    { title: t('quantity'), render: (_, q) => q.quantity === null ? '—' : numberFormat.format(q.quantity) },
    { title: t('state'), render: (_, q) => <Space wrap><Tag color={problem(q) ? 'orange' : 'default'}>{t(`states.${q.state}`)}</Tag>{q.error && <span>{q.error}</span>}{q.quantity !== null && !Number.isInteger(q.quantity) && <Tag color="orange">{t('fractional')}</Tag>}{q.formula && <Tag>{t('cached')}</Tag>}</Space> },
  ];
  const columns: ColumnsType<ForecastSourceRow> = [
    { title: t('sourceRow'), dataIndex: 'sourceRow', width: 90 },
    { title: t('model'), render: (_, row) => <><strong>{row.model || '—'}</strong><div className={styles.secondary}>{row.displayModel}</div></>, width: 200 },
    { title: t('process'), render: (_, row) => <>{row.processLabel}<div className={styles.secondary}>{row.processes.join(' / ') || t('mappingRequired')}</div></>, width: 180 },
    { title: t('numericSubtotal'), render: (_, row) => numberFormat.format(row.quantities.reduce((sum, q) => sum + (q.quantity ?? 0), 0)), width: 160 },
    { title: t('review'), render: (_, row) => <Space wrap>{row.issues.map(issue => <Tag color="orange" key={issue}>{t(`issues.${issue}`)}</Tag>)}<span>{t('problemCells', { count: row.quantities.filter(problem).length })}</span></Space> },
  ];

  return <div className={styles.workspace}>
    <div><Typography.Title level={2}>{t('title')}</Typography.Title><Typography.Paragraph type="secondary">{t('description')}</Typography.Paragraph><Tag>{factoryCode || t('factoryPending')}</Tag></div>
    <Alert type="info" showIcon message={t('stage')} description={t('stageDescription')} />
    <Card title={t('upload')}>
      <Space direction="vertical" className={styles.fullWidth}>
        <label className={styles.fileLabel}>{t('selectFile')}<input key={factoryId} type="file" accept=".xlsx" aria-label={t('selectFile')} disabled={loading || !factoryId} onChange={event => {
          requestRef.current?.abort(); setLoading(false); setPreview(null); setError('');
          const next = event.target.files?.[0] ?? null;
          if (next && (next.size > MAX_BYTES || !/\.xlsx$/i.test(next.name))) { setFile(null); setError(next.size > MAX_BYTES ? 'file_too_large' : 'invalid_filename'); return; }
          setFile(next);
        }} /></label>
        <Typography.Text type="secondary">{t('uploadHelp')}</Typography.Text>
        <Button type="primary" onClick={inspect} loading={loading} disabled={!file || !factoryId}>{t('inspect')}</Button>
        {error && <Alert type="error" showIcon message={t(`errors.${error}`, { defaultValue: t('errors.preview_failed') })} />}
      </Space>
    </Card>
    <Card title={t('capacityTitle')}><Typography.Paragraph>{t('capacityContract')}</Typography.Paragraph><Typography.Text type="secondary">{t('capacityNote')}</Typography.Text>
      {visiblePreview?.capacityPolicy.status === 'available' && <Typography.Paragraph>{t('capacitySettings', { a: visiblePreview.capacityPolicy.shiftAStart, b: visiblePreview.capacityPolicy.shiftBStart, rest: visiblePreview.capacityPolicy.breakMinutes, timezone: visiblePreview.capacityPolicy.timezone })}</Typography.Paragraph>}
      {visiblePreview?.capacityPolicy.status === 'unavailable' && <Alert type="warning" message={t('capacityUnavailable')} />}
    </Card>
    {visiblePreview && <>
      <Alert type="warning" showIcon message={t('reviewRequired')} description={t('reviewDescription')} />
      <Card title={visiblePreview.fileName}>
        <div className={styles.filters}>
          <label>{t('from')}<input type="date" value={start} min={visiblePreview.dates[0]} max={end} onChange={event => setStart(event.target.value)} /></label>
          <label>{t('to')}<input type="date" value={end} min={start} max={visiblePreview.dates.at(-1)} onChange={event => setEnd(event.target.value)} /></label>
          <Checkbox checked={issuesOnly} onChange={event => setIssuesOnly(event.target.checked)}>{t('issuesOnly')}</Checkbox>
        </div>
        {start && end && start > end && <Alert type="error" message={t('invalidPeriod')} />}
        <Row gutter={[16, 16]} className={styles.statistics}>
          <Col xs={12} md={6}><Statistic title={t('sourceRows')} value={visiblePreview.summary.sourceRows} /></Col>
          <Col xs={12} md={6}><Statistic title={t('models')} value={visiblePreview.summary.models} /></Col>
          <Col xs={12} md={6}><Statistic title={t('selectedProblemCells')} value={quantities.filter(problem).length} /></Col>
          <Col xs={12} md={6}><Statistic title={t('mappingRows')} value={selectedRows.filter(row => row.issues.length).length} /></Col>
        </Row>
        <Typography.Paragraph type="secondary">{t('subtotalNote')}</Typography.Paragraph>
        <Table<ForecastSourceRow> columns={columns} dataSource={selectedRows.filter(row => !issuesOnly || row.issues.length || row.quantities.some(problem))} rowKey="sourceRow" scroll={{ x: 850 }} pagination={{ pageSize: 15, showSizeChanger: true }} expandable={{ expandedRowRender: row => <Table<ForecastQuantity> size="small" columns={quantityColumns} dataSource={row.quantities} rowKey="cell" pagination={{ pageSize: 10 }} scroll={{ x: 600 }} /> }} />
        <Typography.Paragraph className={styles.provenance}>{visiblePreview.sheet} · {visiblePreview.parserVersion} · SHA-256: {visiblePreview.sourceHash}</Typography.Paragraph>
      </Card>
      <WeeklySimulationCard preview={visiblePreview} />
    </>}
  </div>;
}
