'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined } from '@ant-design/icons';
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
  /** Which upload request is in flight. Starting one aborts the previous one (requestRef). */
  const [busy, setBusy] = useState<'' | 'inspect' | 'commit'>('');
  const [error, setError] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The factory's accepted Forecast; stays visible while a new file is being inspected. */
  const [accepted, setAccepted] = useState<{ fileName: string; submittedAt: string } | null>(null);
  /**
   * Codex audit F-01: "none" is only what a successful lookup returned. Loading and failure are their own states —
   * otherwise a cancelled or failed lookup told the user there was no accepted Forecast when there was one.
   */
  const [savedStatus, setSavedStatus] = useState<'loading' | 'empty' | 'present' | 'error'>('loading');
  const requestRef = useRef<AbortController | null>(null);
  /** The accepted-Forecast lookup has its own controller: choosing or inspecting a file must not cancel it. */
  const savedRef = useRef<AbortController | null>(null);
  /** Set once the user picks a file: a late lookup then only fills in "accepted", never replaces their preview. */
  const userFileRef = useRef(false);
  const currentFactory = useRef(factoryId);
  currentFactory.current = factoryId;
  const uploading = busy === 'inspect' || busy === 'commit';

  function show(received: FactoryForecastPreview) {
    setPreview(received); setStart(received.dates[0]); setEnd(received.dates[received.dates.length - 1]); setIssuesOnly(false);
    if (received.submission) { setAccepted({ fileName: received.fileName, submittedAt: received.submission.submittedAt }); setSavedStatus('present'); }
  }

  /** undefined = failed or superseded (error already set when it matters); null = the server has nothing to show. */
  async function request(kind: 'inspect' | 'commit', url: string, init: RequestInit, fallback: string): Promise<FactoryForecastPreview | null | undefined> {
    if (!factoryId) return undefined;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const expectedFactory = factoryId;
    setBusy(kind); setError('');
    try {
      const response = await authFetch(url, { ...init, signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted || currentFactory.current !== expectedFactory) return undefined;
      if (!response.ok || !result.success) {
        setError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : (typeof result.code === 'string' ? result.code : fallback));
        return undefined;
      }
      if (result.preview === null) return null;
      if (result.preview?.factory?.id !== expectedFactory) { setError('factory_changed'); return undefined; }
      return result.preview as FactoryForecastPreview;
    } catch {
      if (!controller.signal.aborted && currentFactory.current === expectedFactory) setError(fallback);
      return undefined;
    } finally { if (requestRef.current === controller && !controller.signal.aborted) setBusy(''); }
  }

  async function loadSaved() {
    if (!factoryId) return;
    savedRef.current?.abort();
    const controller = new AbortController();
    savedRef.current = controller;
    const expectedFactory = factoryId;
    setSavedStatus('loading');
    try {
      const response = await authFetch('/api/forecasts/submission', { method: 'GET', signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted || currentFactory.current !== expectedFactory) return;
      if (!response.ok || !result.success || (result.preview !== null && result.preview?.factory?.id !== expectedFactory)) { setSavedStatus('error'); return; }
      if (result.preview === null) { setAccepted(null); setSavedStatus('empty'); return; }
      const saved = result.preview as FactoryForecastPreview;
      if (userFileRef.current) {
        setAccepted({ fileName: saved.fileName, submittedAt: saved.submission?.submittedAt ?? '' }); setSavedStatus('present');
      } else {
        show(saved);
      }
    } catch {
      if (!controller.signal.aborted && currentFactory.current === expectedFactory) setSavedStatus('error');
    }
  }

  // Each factory opens on its last accepted Forecast (user decision 2026-09-29), re-joined with today's machines.
  useEffect(() => {
    setPreview(null); setFile(null); setError(''); setBusy(''); setAccepted(null); setSavedStatus('loading');
    userFileRef.current = false;
    requestRef.current?.abort();
    loadSaved();
    return () => { requestRef.current?.abort(); savedRef.current?.abort(); };
    // loadSaved only reads refs and state setters besides factoryId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  const visiblePreview = preview?.factory.id === factoryId ? preview : null;
  const selectedRows = useMemo(() => (visiblePreview?.rows ?? []).map(row => ({
    ...row, quantities: row.quantities.filter(q => (!start || q.date >= start) && (!end || q.date <= end)),
  })), [visiblePreview, start, end]);
  const problem = (q: ForecastQuantity) => q.state !== 'number' || (q.quantity !== null && !Number.isInteger(q.quantity));
  const quantities = selectedRows.flatMap(row => row.quantities);
  const locale = language === 'vi' ? 'vi-VN' : 'ko-KR';
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 10 });

  /** Picker and drop share one gate: wrong type or size never reaches the server. */
  function choose(next: File | null) {
    requestRef.current?.abort(); setBusy(''); setPreview(null); setError('');
    userFileRef.current = true;
    if (next && (next.size > MAX_BYTES || !/\.xlsx$/i.test(next.name))) { setFile(null); setError(next.size > MAX_BYTES ? 'file_too_large' : 'invalid_filename'); return; }
    setFile(next);
  }

  const fileHeaders = (f: File) => ({ 'Content-Type': 'application/octet-stream', 'x-forecast-file-name': encodeURIComponent(f.name), 'x-forecast-factory-id': factoryId ?? '' });

  async function inspect() {
    if (!file) return;
    setPreview(null);
    const received = await request('inspect', '/api/forecasts/preview', { method: 'POST', body: file, headers: fileHeaders(file) }, 'preview_failed');
    if (received) show(received);
  }

  /** '접수 확정': the same file goes again and the server stores its own reading, pinned to the hash the user saw. */
  async function commit() {
    if (!file || !visiblePreview || visiblePreview.submission) return;
    const received = await request('commit', '/api/forecasts/submission', {
      method: 'POST', body: file, headers: { ...fileHeaders(file), 'x-forecast-source-hash': visiblePreview.sourceHash },
    }, 'submission_failed');
    if (!received) return;
    // Codex re-audit R-01: a lookup still in flight read the state before this acceptance. Cancel it so its late
    // answer (none, the older file, or an error) cannot undo what just succeeded. Only on success — a failed commit
    // leaves the lookup running, so the accepted state still gets filled in.
    savedRef.current?.abort();
    show(received);
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
        <label
          className={`${styles.dropZone}${dragging ? ` ${styles.dropZoneActive}` : ''}${uploading || !factoryId ? ` ${styles.dropZoneDisabled}` : ''}`}
          data-testid="forecast-drop-zone"
          onDragOver={event => { event.preventDefault(); if (!uploading && factoryId) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!uploading && factoryId) choose(event.dataTransfer.files?.[0] ?? null); }}>
          <input key={factoryId} className={styles.fileInput} type="file" accept=".xlsx" aria-label={t('selectFile')} disabled={uploading || !factoryId}
            onChange={event => choose(event.target.files?.[0] ?? null)} />
          <InboxOutlined className={styles.dropIcon} aria-hidden />
          <span className={styles.dropTitle}>{t('dropTitle')}</span>
          {file ? <Tag color="blue">{t('selectedFile', { name: file.name })}</Tag> : <span className={styles.secondary}>{t('noFile')}</span>}
        </label>
        <Typography.Text type="secondary">{t('uploadHelp')}</Typography.Text>
        <Button type="primary" onClick={inspect} loading={busy === 'inspect'} disabled={!file || !factoryId || uploading}>{t('inspect')}</Button>
        {savedStatus === 'present' && accepted && <Alert type="success" showIcon data-testid="accepted-forecast" message={t('acceptedTitle', { name: accepted.fileName, time: new Date(accepted.submittedAt).toLocaleString(locale) })} />}
        {savedStatus === 'empty' && <Typography.Text type="secondary" data-testid="no-accepted-forecast">{t('noAccepted')}</Typography.Text>}
        {savedStatus === 'error' && <Alert type="warning" showIcon data-testid="accepted-load-failed" message={t('errors.submission_load_failed')}
          action={<Button size="small" onClick={loadSaved} data-testid="retry-accepted">{t('retry')}</Button>} />}
        {error && <Alert type="error" showIcon message={t(`errors.${error}`, { defaultValue: t('errors.preview_failed') })} />}
      </Space>
    </Card>
    <Card title={t('capacityTitle')}><Typography.Paragraph>{t('capacityContract')}</Typography.Paragraph><Typography.Text type="secondary">{t('capacityNote')}</Typography.Text>
      {visiblePreview?.capacityPolicy.status === 'available' && <Typography.Paragraph>{t('capacitySettings', { a: visiblePreview.capacityPolicy.shiftAStart, b: visiblePreview.capacityPolicy.shiftBStart, rest: visiblePreview.capacityPolicy.breakMinutes, timezone: visiblePreview.capacityPolicy.timezone })}</Typography.Paragraph>}
      {visiblePreview?.capacityPolicy.status === 'unavailable' && <Alert type="warning" message={t('capacityUnavailable')} />}
    </Card>
    {visiblePreview && <>
      {!visiblePreview.submission && <Alert type="warning" showIcon data-testid="unsaved-forecast" message={t('unsavedTitle')} description={t('unsavedDescription')}
        action={<Button type="primary" onClick={commit} loading={busy === 'commit'} disabled={!file || uploading} data-testid="commit-forecast">{t('commit')}</Button>} />}
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
