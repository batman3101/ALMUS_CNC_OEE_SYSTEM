'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table, Card, Button, Space, Select, DatePicker, InputNumber, Typography, Tag, Alert, App, Row, Col
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { authFetch } from '@/lib/authFetch';
import { useMachines } from '@/hooks/useMachines';
import { useDataInputTranslation } from '@/hooks/useTranslation';
import { useFailureReport } from '@/hooks/useFailureReport';
import type { QueueSortField } from '@/app/api/production-records/close-queue/queueSort';
import type { SorterResult } from 'antd/es/table/interface';

const { Text, Title } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

interface QueueItem {
  machine_id: string;
  machine_name: string;
  date: string;
  shift: 'A' | 'B';
  last_qty: number | null;
}

/** 안정 키. 폴링·재조회로 배열 순서가 바뀌어도 입력값이 다른 교대로 옮겨가지 않게 한다. */
const keyOf = (i: QueueItem) => `${i.machine_id}|${i.date}|${i.shift}`;

/**
 * 전사 교대 마감 대기 큐.
 *
 * 현장 콘솔은 **설비 한 대**의 대기만 보여준다. 전사 수백 건을 처리하려면 설비를 계속 바꿔야
 * 했다(감사 P1-2). 이 표는 설비·업무일·교대·마지막 진척을 한 줄에 놓고 행마다 최종수량을
 * 입력해 개별 마감한다.
 *
 * **일괄 자동 마감은 제공하지 않는다.** 교대마다 최종 수량이 다르고 종이 카운터를 눈으로
 * 확인해야 하기 때문이다 — 마지막 진척값으로 일괄 확정하면 확인하지 않은 숫자가 역사로 남는다.
 */
export const CloseShiftQueue: React.FC = () => {
  const { t } = useDataInputTranslation();
  const { machines, loading: machinesLoading } = useMachines();
  const { message: messageApi } = App.useApp();
  const reportFailure = useFailureReport();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  /**
   * 정렬 상태. **서버가 정렬한다** — 서버는 대기 목록 전체를 만들어 정렬한 뒤 페이지를
   * 자르므로, 클라이언트 정렬이면 화면에 온 20건 안에서만 정렬됐을 것이다.
   * `null` 이면 서버 기본값(오래된 교대 먼저)이다.
   */
  const [sortState, setSortState] = useState<{
    field: QueueSortField;
    order: 'ascend' | 'descend';
  } | null>(null);

  const [machineId, setMachineId] = useState<string | null>(null);
  const [shift, setShift] = useState<'A' | 'B' | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(6, 'day'), dayjs()]);

  /** 행별 입력값·오류. 저장에 실패해도 입력한 숫자를 잃지 않게 키로 보관한다. */
  const [qtyByKey, setQtyByKey] = useState<Record<string, number | null>>({});
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const reqRef = useRef(0);

  const fetchQueue = useCallback(async () => {
    const reqId = ++reqRef.current;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pagination.current),
        limit: String(pagination.pageSize),
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
      });
      if (machineId) params.append('machine_id', machineId);
      if (shift) params.append('shift', shift);
      if (sortState) {
        params.append('sort', sortState.field);
        params.append('order', sortState.order === 'ascend' ? 'asc' : 'desc');
      }

      const res = await authFetch(`/api/production-records/close-queue?${params.toString()}`, {
        cache: 'no-store',
      });
      if (reqId !== reqRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as {
        items: QueueItem[];
        pagination: { total: number };
        truncated: boolean;
      };
      if (reqId !== reqRef.current) return;

      setItems(body.items ?? []);
      setTruncated(Boolean(body.truncated));
      setPagination(prev => ({ ...prev, total: body.pagination?.total ?? 0 }));
    } catch (error) {
      if (reqId !== reqRef.current) return;
      reportFailure(t('closeQueue.loadError'), error);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, machineId, shift, range, sortState, t]);

  useEffect(() => { void fetchQueue(); }, [fetchQueue]);
  useEffect(() => () => { reqRef.current++; }, []);

  const closeRow = async (item: QueueItem) => {
    const key = keyOf(item);
    const qty = qtyByKey[key] ?? item.last_qty;
    if (qty === null || qty === undefined) return;

    setSavingKey(key);
    setErrorByKey(prev => { const next = { ...prev }; delete next[key]; return next; });

    try {
      const res = await authFetch('/api/production-records/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: item.machine_id, date: item.date, shift: item.shift, final_qty: qty,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as {
          error?: string; last_progress_qty?: number; defect_qty?: number;
        } | null;
        /*
          실패 사유를 행에 **구체적으로** 남긴다. "저장 실패" 한 마디로 뭉개면 사용자는
          같은 저장을 반복하는 것 말고 할 수 있는 일이 없다.
          진척보다 낮은 마감은 사유가 필요한데, 그 확인 흐름은 현장 콘솔이 담당한다 —
          여기서는 어디로 가야 하는지 알려 준다.
        */
        const reason =
          body?.error === 'below_progress_needs_reason'
            ? t('closeQueue.errorBelowProgress', { qty: body.last_progress_qty ?? 0 })
            : body?.error === 'output_qty is less than confirmed defect_qty'
              ? t('closeQueue.errorBelowDefect', { qty: body.defect_qty ?? 0 })
              : body?.error?.includes('still open')
                ? t('closeQueue.errorTooEarly')
                : t('closeQueue.errorGeneric');
        setErrorByKey(prev => ({ ...prev, [key]: reason }));
        return;
      }

      // 성공한 행만 목록에서 제거한다 — 전체 재조회는 다른 행의 입력 중인 숫자를 흔든다.
      setItems(prev => prev.filter(i => keyOf(i) !== key));
      setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      setQtyByKey(prev => { const next = { ...prev }; delete next[key]; return next; });
      messageApi.success(t('closeQueue.closeSuccess', { machine: item.machine_name }));
    } catch (error) {
      setErrorByKey(prev => ({ ...prev, [key]: t('closeQueue.errorGeneric') }));
      reportFailure(t('closeQueue.errorGeneric'), error);
    } finally {
      setSavingKey(null);
    }
  };

  const columns = [
    {
      title: t('recordList.columns.machine'),
      key: 'machine_name',
      width: 140,
      sorter: true,
      sortOrder: sortState?.field === 'machine_name' ? sortState.order : null,
      render: (_: unknown, item: QueueItem) => <Text strong>{item.machine_name}</Text>,
    },
    {
      title: t('recordList.columns.date'),
      dataIndex: 'date',
      key: 'date',
      width: 110,
      sorter: true,
      sortOrder: sortState?.field === 'date' ? sortState.order : null,
    },
    {
      title: t('recordList.columns.shift'),
      dataIndex: 'shift',
      key: 'shift',
      width: 80,
      sorter: true,
      sortOrder: sortState?.field === 'shift' ? sortState.order : null,
      render: (s: string) => (
        <Tag color={s === 'A' ? 'orange' : 'blue'}>
          {s === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
        </Tag>
      ),
    },
    {
      title: t('closeQueue.lastProgress'),
      dataIndex: 'last_qty',
      key: 'last_qty',
      width: 100,
      align: 'right' as const,
      sorter: true,
      sortOrder: sortState?.field === 'last_qty' ? sortState.order : null,
      render: (q: number | null) =>
        q === null ? <Text type="secondary">—</Text> : `${q.toLocaleString()} ${t('common.pieces')}`,
    },
    {
      title: t('closeQueue.finalQty'),
      key: 'final_qty',
      width: 150,
      render: (_: unknown, item: QueueItem) => {
        const key = keyOf(item);
        return (
          <InputNumber
            value={qtyByKey[key] ?? item.last_qty}
            onChange={(v) => setQtyByKey(prev => ({ ...prev, [key]: v }))}
            min={0}
            precision={0}
            style={{ width: '100%' }}
            placeholder={t('closeQueue.finalQty')}
          />
        );
      },
    },
    {
      title: t('closeQueue.status'),
      key: 'status',
      render: (_: unknown, item: QueueItem) => {
        const key = keyOf(item);
        return errorByKey[key]
          ? <Text type="danger" style={{ fontSize: 12 }}>{errorByKey[key]}</Text>
          : <Text type="secondary" style={{ fontSize: 12 }}>{t('closeQueue.statusPending')}</Text>;
      },
    },
    {
      title: t('recordList.columns.actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, item: QueueItem) => {
        const key = keyOf(item);
        const qty = qtyByKey[key] ?? item.last_qty;
        return (
          <Button
            type="primary"
            size="small"
            loading={savingKey === key}
            disabled={qty === null || qty === undefined}
            onClick={() => closeRow(item)}
          >
            {t('closeQueue.close')}
          </Button>
        );
      },
    },
  ];

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>{t('closeQueue.title')}</Title>
          <Text type="secondary">({t('recordList.totalRecords', { count: pagination.total })})</Text>
        </Space>
      }
      extra={<Button icon={<ReloadOutlined />} onClick={fetchQueue} loading={loading}>
        {t('recordList.refresh')}
      </Button>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('closeQueue.description')}</Text>

        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={7}>
            <Select
              placeholder={t('recordList.allMachines')}
              allowClear
              loading={machinesLoading}
              value={machineId}
              onChange={(v) => { setMachineId(v ?? null); setPagination(p => ({ ...p, current: 1 })); }}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="children"
            >
              {machines.map(m => <Option key={m.id} value={m.id}>{m.name}</Option>)}
            </Select>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <RangePicker
              value={range}
              allowClear={false}
              onChange={(d) => {
                if (d && d[0] && d[1]) { setRange([d[0], d[1]]); setPagination(p => ({ ...p, current: 1 })); }
              }}
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              placeholder={t('recordList.allShifts')}
              allowClear
              value={shift}
              onChange={(v) => { setShift(v ?? null); setPagination(p => ({ ...p, current: 1 })); }}
              style={{ width: '100%' }}
            >
              <Option value="A">{t('shift.dayShift')}</Option>
              <Option value="B">{t('shift.nightShift')}</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Button
              icon={<SearchOutlined />}
              onClick={() => setPagination(p => ({ ...p, current: 1 }))}
              style={{ width: '100%' }}
            >
              {t('recordList.search')}
            </Button>
          </Col>
        </Row>

        {truncated && <Alert type="warning" showIcon message={t('closeQueue.truncated')} />}

        <Table
          columns={columns}
          dataSource={items}
          rowKey={keyOf}
          loading={loading}
          size="small"
          /** 정렬은 서버가 한다. antd 가 넘겨준 컬럼·방향을 상태에 담으면 다시 조회한다. */
          onChange={(_pag, _filters, sorter) => {
            const single = Array.isArray(sorter) ? sorter[0] : (sorter as SorterResult<QueueItem>);
            const field = single?.columnKey as QueueSortField | undefined;
            const order = single?.order;
            const next = field && order ? { field, order } : null;
            /**
             * ⚠️ 이 콜백은 **페이지를 넘길 때도 호출된다.** 정렬이 그대로인데도 아래
             * `current: 1` 을 실행하면, 사용자가 4페이지를 눌러도 곧바로 1페이지로
             * 되돌아온다(2026-08-28 브라우저 테스트에서 실제로 그랬다).
             * 그래서 정렬이 **바뀐 경우에만** 손댄다.
             */
            if (next?.field === sortState?.field && next?.order === sortState?.order) return;
            setSortState(next);
            // 순서가 달라졌는데 3페이지에 머물면 사용자가 보는 것은 "3번째 20건" 이라는
            // 무의미한 창이다. 정렬을 바꾸면 처음으로 돌아간다.
            setPagination(prev => (prev.current === 1 ? prev : { ...prev, current: 1 }));
          }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => t('recordList.totalRecords', { count: total }),
            onChange: (page, pageSize) =>
              setPagination(prev => ({ ...prev, current: page, pageSize: pageSize || 20 })),
          }}
          scroll={{ x: 860 }}
          locale={{ emptyText: t('closeQueue.empty') }}
        />
      </Space>
    </Card>
  );
};

export default CloseShiftQueue;
