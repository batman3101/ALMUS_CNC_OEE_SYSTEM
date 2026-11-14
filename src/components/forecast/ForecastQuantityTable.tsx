'use client';

import { useState } from 'react';
import { Button, InputNumber, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import { authFetch } from '@/lib/authFetch';
import { effectiveQuantity, MAX_PO_QUANTITY, parsePoQuantity } from '@/lib/forecast/poOverrides';
import type { ForecastQuantity, ForecastSourceRow, PoOverride } from '@/types/forecast';
import styles from './ForecastWorkspace.module.css';

interface Props {
  row: ForecastSourceRow;
  /** 화면이 보고 있는 접수 번호. null 이면 아직 접수 확정 전이라 읽기 전용이다. */
  submissionId: string | null;
  numberFormat: Intl.NumberFormat;
  /** 서버가 받아들인 뒤에 부른다: po 가 null 이면 원복이다. `submissionId` 는 요청을 보낼 때 본 접수 번호다. */
  onChange: (submissionId: string, sourceRow: number, date: string, po: PoOverride | null) => void;
  /** 서버 거부·통신 실패. `code` 는 errors.<code> 번역 키, `cause` 는 응답이나 예외(세션 만료 판정에 쓴다). */
  onError: (code: string, cause?: unknown) => void;
}

const problem = (q: ForecastQuantity) => q.state !== 'number' || (q.quantity !== null && !Number.isInteger(q.quantity));

/**
 * 한 원본 행의 날짜별 수량 표 + 실제 PO 수량 입력 (사용자 요청 2026-09-29).
 *
 * Forecast 접수 뒤 실제 PO 가 바뀌면 날짜마다 '실제 PO 수량'을 입력하고 [적용]을 누른다. 서버가 그 칸의 수정값을 기록하고
 * (변경 이력 포함) 시뮬레이션이 그 값을 쓴다. 원본 Forecast 수량은 지우지 않고 '수량' 아래에 그대로 보인다.
 * [원복]은 수정값을 지워 Forecast 값으로 되돌린다.
 */
export default function ForecastQuantityTable({ row, submissionId, numberFormat, onChange, onError }: Props) {
  const { t, language } = useTranslation('forecast');
  // 입력 중인 값(적용 전). undefined = 건드리지 않음 → 현재 적용된 값을 보여 준다.
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // 시뮬레이션은 CNC1~CNC2 로 매핑된 행만 읽는다 — 그 밖의 행에 입력하면 효과 없이 남으므로 막는다.
  const supported = Boolean(row.model) && row.processes.length > 0;
  const editable = submissionId !== null && supported;
  const format = (value: number | null) => (value === null ? '—' : numberFormat.format(value));

  async function send(date: string, method: 'PUT' | 'DELETE', extra: object, accept: (submissionId: string, body: { po?: PoOverride }) => void) {
    // 보낼 때 본 접수 번호를 붙잡아 둔다 - 응답이 오기 전에 화면의 접수본이 바뀌었는지 부모가 가려낼 수 있어야 한다.
    const requestedSubmission = submissionId;
    if (requestedSubmission === null) return;
    setSaving(s => ({ ...s, [date]: true }));
    try {
      const response = await authFetch('/api/forecasts/po-overrides', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: requestedSubmission, sourceRow: row.sourceRow, date, ...extra }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        onError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : (typeof body.code === 'string' ? body.code : 'po_save_failed'), response);
        return;
      }
      accept(requestedSubmission, body);
      setDrafts(current => { const next = { ...current }; delete next[date]; return next; });
    } catch (error) {
      console.error('Forecast PO override request failed:', error);
      onError('po_save_failed', error);
    } finally {
      setSaving(s => ({ ...s, [date]: false }));
    }
  }

  const isDirty = (q: ForecastQuantity) => {
    const draft = drafts[q.date];
    const parsed = parsePoQuantity(draft);
    return draft !== undefined && parsed !== null && parsed !== (q.po?.quantity ?? null);
  };
  const apply = (q: ForecastQuantity) => {
    const quantity = parsePoQuantity(drafts[q.date]);
    if (!editable || saving[q.date] || quantity === null || quantity === (q.po?.quantity ?? null)) return;
    return send(q.date, 'PUT', { quantity }, (requested, body) => {
      if (body.po) onChange(requested, row.sourceRow, q.date, { quantity: body.po.quantity, updatedAt: body.po.updatedAt });
    });
  };
  const revert = (q: ForecastQuantity) => {
    if (!editable || saving[q.date] || !q.po) return;
    return send(q.date, 'DELETE', {}, requested => onChange(requested, row.sourceRow, q.date, null));
  };

  const columns: ColumnsType<ForecastQuantity> = [
    { title: t('date'), dataIndex: 'date', width: 110 },
    { title: t('cell'), dataIndex: 'cell', width: 80 },
    {
      title: t('po.quantityUsed'), key: 'quantity', width: 190,
      render: (_, q) => {
        const used = effectiveQuantity(q);
        if (!q.po) return format(used.quantity);
        return <><strong>{format(used.quantity)}</strong><div className={styles.secondary}>{t('po.forecastOriginal', { n: format(q.quantity) })}</div></>;
      },
    },
    {
      title: t('state'), key: 'state',
      render: (_, q) => <Space wrap>
        <Tag color={problem(q) ? 'orange' : 'default'}>{t(`states.${q.state}`)}</Tag>
        {q.error && <span>{q.error}</span>}
        {q.quantity !== null && !Number.isInteger(q.quantity) && <Tag color="orange">{t('fractional')}</Tag>}
        {q.formula && <Tag>{t('cached')}</Tag>}
        {q.po && <Tag color="blue" title={t('po.updatedAt', { time: new Date(q.po.updatedAt).toLocaleString(language === 'vi' ? 'vi-VN' : 'ko-KR') })}>{t('po.tag')}</Tag>}
      </Space>,
    },
    {
      title: t('po.input'), key: 'poInput', width: 150,
      render: (_, q) => {
        const draft = drafts[q.date];
        return <InputNumber
          size="small" min={0} max={MAX_PO_QUANTITY} precision={0} controls={false} style={{ width: 120 }}
          value={draft !== undefined ? draft : (q.po?.quantity ?? null)}
          disabled={!editable || Boolean(saving[q.date])} placeholder={t('po.placeholder')}
          aria-label={`${t('po.input')} ${q.date}`}
          onChange={value => setDrafts(current => ({ ...current, [q.date]: value === null ? null : Number(value) }))}
          onPressEnter={() => apply(q)}
        />;
      },
    },
    {
      title: '', key: 'poActions', width: 130,
      render: (_, q) => <Space size={4}>
        <Button size="small" type="primary" disabled={!editable || !isDirty(q)} loading={Boolean(saving[q.date])} onClick={() => apply(q)}
          aria-label={`${t('po.apply')} ${q.date}`}>{t('po.apply')}</Button>
        {q.po && <Button size="small" disabled={!editable || Boolean(saving[q.date])} onClick={() => revert(q)}
          aria-label={`${t('po.revert')} ${q.date}`}>{t('po.revert')}</Button>}
      </Space>,
    },
  ];

  return <>
    {!editable && <Typography.Text type="secondary" data-testid="po-disabled-reason">
      {submissionId === null ? t('po.needsAcceptance') : t('po.unsupportedRow')}
    </Typography.Text>}
    <Table<ForecastQuantity> size="small" columns={columns} dataSource={row.quantities} rowKey="cell" pagination={{ pageSize: 10 }} scroll={{ x: 780 }} />
  </>;
}
