'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Select,
  DatePicker,
  Modal,
  Form,
  InputNumber,
  Typography,
  Popconfirm,
  Tag,
  Row,
  Col,
  App,
  Tooltip,
  theme
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  LockOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useMachines } from '@/hooks/useMachines';
import { useDataInputTranslation } from '@/hooks/useTranslation';
import { formatMachineLocation } from '@/utils/machineLocation';
import { authFetch } from '@/lib/authFetch';
import { useFailureReport } from '@/hooks/useFailureReport';
import { useAuth } from '@/contexts/AuthContext';
import { canDeleteProductionRecord, type UserRole } from '@/lib/pageAccess';

const { Text, Title } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

interface ProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  output_qty: number;
  /**
   * NULL = **미검사**다. 불량 0건과 다르다.
   *
   * 교대 마감은 생산량만 확정하고 이 값을 NULL 로 남긴다 — 검사 결과는 다음날 나온다.
   * `number` 로 적으면 그 세 번째 상태를 표현할 수 없고, 그 타입 거짓말이 실제로
   * "미검사 행을 0건으로 확정 저장"하는 버그를 만들었다(같은 교훈이 아래 지표 필드들).
   */
  defect_qty: number | null;
  // 비가동/실가동이 확인되지 않은 기록은 서버가 NULL 로 남긴다(0 으로 추정하지 않는다).
  // null 을 표현할 수 있어야 "미보고"와 "실제 0%"를 구분할 수 있다.
  planned_runtime?: number | null;
  actual_runtime?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  oee?: number | null;
  created_at?: string;
  machine?: {
    id: string;
    name: string;
    location: string;
  };
}

interface ProductionRecordListProps {
  title?: string;
}

const ProductionRecordList: React.FC<ProductionRecordListProps> = ({ title }) => {
  const { t } = useDataInputTranslation();
  const { machines, loading: machinesLoading } = useMachines();
  const { message: messageApi } = App.useApp();
  const reportFailure = useFailureReport();
  // 삭제 권한은 API 와 **같은 함수**로 판단한다. 여기서 역할을 다시 적으면 규칙이 둘이 된다.
  const { user } = useAuth();
  const canDelete = canDeleteProductionRecord(user?.role as UserRole | undefined);
  const { token } = theme.useToken();

  // 상태
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });

  // 필터 상태
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selectedShift, setSelectedShift] = useState<string | null>(null);
  // NG 확정 상태 필터('pending' = 미검사). 다음날 불량 입력의 작업 목록을 만드는 수단이다.
  const [defectStatus, setDefectStatus] = useState<'pending' | 'confirmed' | null>(null);

  // NG 확정 전용 모달 상태 — 일반 수정(PUT)과 **다른 경로**(/defect PATCH)를 쓴다.
  const [defectModalRecord, setDefectModalRecord] = useState<ProductionRecord | null>(null);
  const [defectQtyInput, setDefectQtyInput] = useState<number | null>(null);
  const [confirmingDefect, setConfirmingDefect] = useState(false);

  // 수정 모달 상태
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ProductionRecord | null>(null);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // 요청 경쟁 상태 방지를 위한 시퀀스 가드
  const fetchRequestSeqRef = useRef(0);

  // 생산 기록 조회
  const fetchRecords = useCallback(async () => {
    const requestId = ++fetchRequestSeqRef.current;
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('page', pagination.current.toString());
      params.append('limit', pagination.pageSize.toString());

      if (selectedMachineId) {
        params.append('machine_id', selectedMachineId);
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.append('startDate', dateRange[0].format('YYYY-MM-DD'));
        params.append('endDate', dateRange[1].format('YYYY-MM-DD'));
      }
      if (selectedShift) {
        params.append('shift', selectedShift);
      }
      // 서버에서 거른다. 받은 페이지를 클라이언트에서 다시 거르면 페이지네이션 총계가
      // 어긋나 "20건 중 3건"처럼 보인다(필터는 조회 조건이지 표시 조건이 아니다).
      if (defectStatus) {
        params.append('defect_status', defectStatus);
      }

      const response = await authFetch(`/api/production-records?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      // 이 응답이 가장 최근 요청의 응답이 아니면 무시 (경쟁 상태 방지)
      if (requestId !== fetchRequestSeqRef.current) {
        return;
      }

      setRecords(result.records || []);
      setPagination(prev => ({
        ...prev,
        total: result.pagination?.total || 0
      }));
    } catch (error) {
      if (requestId !== fetchRequestSeqRef.current) {
        return;
      }
      console.error('Error fetching production records:', error);
      reportFailure(t('recordList.loadError'), error);
    } finally {
      if (requestId === fetchRequestSeqRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, selectedMachineId, dateRange, selectedShift, defectStatus, messageApi, t]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 수정 모달 열기
  const openEditModal = (record: ProductionRecord) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      output_qty: record.output_qty,
      defect_qty: record.defect_qty
    });
    setEditModalVisible(true);
  };

  // 수정 저장
  const handleEditSave = async () => {
    if (!editingRecord) return;

    let values: { output_qty: number; defect_qty?: number | null };
    try {
      values = await editForm.validateFields();
    } catch {
      // 유효성 검사 실패: AntD가 필드별 오류를 이미 표시하므로 저장 실패 메시지는 띄우지 않음
      return;
    }

    /**
     * 불량 칸이 비어 있으면 `defect_qty` 를 **보내지 않는다**.
     *
     * 서버의 `buildUpdateData` 는 `undefined` 를 "이 필드는 건드리지 않음"으로 읽어 기존 값을
     * 그대로 둔다. 반대로 `0` 을 보내면 그것은 **"불량 0건으로 확정한다"는 선언**이라
     * quality/OEE 까지 계산된다.
     *
     * 예전에는 목록 API 가 NULL 을 0 으로 바꿔 내려보냈고 모달이 그 0 을 prefill 했기 때문에,
     * 생산량 한 자리만 고쳐도 미검사 교대가 "불량 0건 검사 완료"로 확정 저장됐다.
     * 이 화면은 일반 정정용이다 — 불량 확정은 전용 버튼(`/defect`)이 담당한다.
     */
    const payload: { output_qty: number; defect_qty?: number } =
      values.defect_qty === null || values.defect_qty === undefined
        ? { output_qty: values.output_qty }
        : { output_qty: values.output_qty, defect_qty: values.defect_qty };

    try {
      setSaving(true);

      const response = await authFetch(`/api/production-records/${editingRecord.record_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      // 본문을 **먼저** 읽는다. 예전에는 `!response.ok` 이면 status 만 보고 바로 던져서,
      // 서버가 실어 보낸 사유가 버려졌다. 그 결과 동시 수정 충돌(409)까지 "저장 실패"라는
      // 같은 문구로 뭉개졌고, 사용자는 원인을 알 수 없어 같은 저장을 반복했다.
      const result = await response.json().catch(() => null);

      /**
       * 409 = 내가 화면에 띄운 값이 이미 낡았다는 뜻이다(다른 사람의 마감·불량확정이 먼저 저장됨).
       * 이건 "다시 시도"로 풀리는 실패가 아니라 **다시 불러와야** 하는 실패다 —
       * 재시도하면 남의 확정값을 덮어쓰려는 시도를 반복할 뿐이다.
       * 그래서 문구를 구분하고, 목록을 새로 읽어 최신 상태를 보여준 뒤 모달을 닫는다.
       */
      if (response.status === 409) {
        messageApi.warning(result?.message ?? t('messages.recordChanged'));
        setEditModalVisible(false);
        setEditingRecord(null);
        editForm.resetFields();
        fetchRecords();
        return;
      }

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || result?.error || `HTTP ${response.status}`);
      }

      messageApi.success(t('messages.recordUpdateSuccess'));
      setEditModalVisible(false);
      setEditingRecord(null);
      editForm.resetFields();
      fetchRecords();
    } catch (error) {
      console.error('Error updating production record:', error);
      reportFailure(t('messages.saveFailed'), error);
    } finally {
      setSaving(false);
    }
  };

  // 삭제
  const handleDelete = async (recordId: string) => {
    try {
      setLoading(true);

      const response = await authFetch(`/api/production-records/${recordId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        messageApi.success(t('messages.recordDeleteSuccess'));
        fetchRecords();
      } else {
        throw new Error(result.error || 'Delete failed');
      }
    } catch (error) {
      console.error('Error deleting production record:', error);
      reportFailure(t('messages.recordDeleteFailed'), error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * NG 확정 — 일반 수정(PUT)이 아니라 **전용 경로**(`PATCH .../defect`)를 쓴다.
   *
   * 두 경로는 하는 일이 다르다. PUT 은 행 전체를 읽어 파생지표를 다시 계산해 덮어쓰고,
   * `/defect` 는 `confirm_shift_defect` RPC 가 교대 잠금(machine·date·shift) 아래에서
   * quality/oee 만 재파생한다 — 가동률·성능 스냅샷은 그대로 둔다. 다음날 불량 입력 때문에
   * 그 교대의 가동 이력이 오늘 값으로 덮이면 안 되기 때문이다.
   */
  const handleConfirmDefect = async () => {
    if (!defectModalRecord || defectQtyInput === null) return;

    try {
      setConfirmingDefect(true);
      const response = await authFetch(
        `/api/production-records/${defectModalRecord.record_id}/defect`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defect_qty: defectQtyInput })
        }
      );

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }

      messageApi.success(t('recordList.defectModal.confirmSuccess'));
      setDefectModalRecord(null);
      setDefectQtyInput(null);
      fetchRecords();
    } catch (error) {
      console.error('Error confirming defect:', error);
      reportFailure(t('recordList.defectModal.confirmFailed'), error);
    } finally {
      setConfirmingDefect(false);
    }
  };

  // 필터 초기화
  const resetFilters = () => {
    setSelectedMachineId(null);
    setDateRange(null);
    setSelectedShift(null);
    setDefectStatus(null);
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  // 테이블 컬럼
  const columns = [
    {
      title: t('recordList.columns.date'),
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD')
    },
    {
      title: t('recordList.columns.machine'),
      dataIndex: 'machine',
      key: 'machine',
      width: 150,
      render: (machine: ProductionRecord['machine']) => (
        <div>
          <div>{machine?.name || '-'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatMachineLocation(machine?.location, t)}</Text>
        </div>
      )
    },
    {
      title: t('recordList.columns.shift'),
      dataIndex: 'shift',
      key: 'shift',
      width: 80,
      render: (shift: string) => (
        <Tag color={shift === 'A' ? 'orange' : 'blue'}>
          {shift === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
        </Tag>
      )
    },
    {
      title: t('recordList.columns.outputQty'),
      dataIndex: 'output_qty',
      key: 'output_qty',
      width: 100,
      align: 'right' as const,
      render: (qty: number) => `${qty?.toLocaleString() || 0} ${t('common.pieces')}`
    },
    {
      title: t('recordList.columns.defectQty'),
      dataIndex: 'defect_qty',
      key: 'defect_qty',
      width: 100,
      align: 'right' as const,
      // 세 상태를 **구분해서** 보여준다: 미검사 / 0건 확정 / 실제 불량.
      // 예전에는 `qty || 0` 이라 미검사가 "0개"로 보였고, 사용자는 검사가 끝난 줄 알았다.
      render: (qty: number | null | undefined) => {
        if (qty === null || qty === undefined) {
          return <Tag color="warning">{t('recordList.defectPending')}</Tag>;
        }
        return (
          <Text type={qty > 0 ? 'danger' : undefined}>
            {qty.toLocaleString()} {t('common.pieces')}
          </Text>
        );
      }
    },
    {
      title: t('recordList.columns.goodQty'),
      key: 'good_qty',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, record: ProductionRecord) => {
        // 불량이 미검사면 양품수량은 **아직 모른다**. `output - 0` 으로 확정하면 전량이
        // 양품인 것처럼 보이고, 그게 곧 "검사 완료"라는 오해가 된다.
        if (record.defect_qty === null || record.defect_qty === undefined) {
          return <Text type="secondary">{t('recordList.goodQtyUnknown')}</Text>;
        }
        const goodQty = Math.max(0, (record.output_qty || 0) - record.defect_qty);
        return <Text type="success">{goodQty.toLocaleString()} {t('common.pieces')}</Text>;
      }
    },
    {
      title: t('recordList.columns.oee'),
      dataIndex: 'oee',
      key: 'oee',
      width: 80,
      align: 'right' as const,
      render: (oee: number | null | undefined) => {
        // OEE 가 NULL 인 기록은 "0%"가 아니라 "미보고"다. 비가동/실가동이 확인되지
        // 않아 서버가 계산을 보류한 상태이며, 0 으로 뭉개면 정상 가동 중인 설비가
        // 완전 정지처럼 빨갛게 보인다 (EngineerDashboard 의 oeeUnavailable 과 동일 규약).
        if (oee === null || oee === undefined) {
          return <Tag>{t('recordList.oeeUnreported')}</Tag>;
        }
        const oeePercent = oee * 100;
        let color = 'green';
        if (oeePercent < 60) color = 'red';
        else if (oeePercent < 80) color = 'orange';
        return <Tag color={color}>{oeePercent.toFixed(1)}%</Tag>;
      }
    },
    {
      title: t('recordList.columns.actions'),
      key: 'actions',
      width: 200,
      render: (_: unknown, record: ProductionRecord) => (
        <Space size="small">
          {/*
            미검사 행에만 NG 확정 버튼을 띄운다. 이 버튼이 다음날 불량 입력의 **주 경로**다 —
            일반 수정 모달은 정정용이고 확정의 의미를 갖지 않는다.
          */}
          {(record.defect_qty === null || record.defect_qty === undefined) && (
            <Button
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => {
                setDefectModalRecord(record);
                setDefectQtyInput(null);
              }}
            >
              {t('recordList.confirmDefect')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            {t('recordList.edit')}
          </Button>
          {/*
            삭제 권한이 없으면 버튼을 **없애지 않고** 자물쇠와 함께 비활성으로 남긴다.
            사라지면 "내 화면에는 그 기능이 없다"가 되어 무엇이 존재하는지조차 알 수 없다 —
            `pageAccess` 가 사이드바에서 세운 원칙과 같다. 예전에는 아무 표시 없이 눌리기만
            했고 요청은 항상 403 이었다.
          */}
          {canDelete ? (
            <Popconfirm
              title={t('messages.confirmDelete')}
              description={t('messages.confirmDeleteDescription')}
              onConfirm={() => handleDelete(record.record_id)}
              okText={t('recordList.delete')}
              cancelText={t('recordList.editModal.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                {t('recordList.delete')}
              </Button>
            </Popconfirm>
          ) : (
            <Tooltip title={t('recordList.deleteNotAllowed')}>
              <Button type="link" size="small" disabled icon={<LockOutlined />}>
                {t('recordList.delete')}
              </Button>
            </Tooltip>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* 필터 카드 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.columns.machine')}</Text>
              <Select
                placeholder={t('recordList.allMachines')}
                allowClear
                loading={machinesLoading}
                value={selectedMachineId}
                onChange={(value) => {
                  setSelectedMachineId(value);
                  setPagination(prev => ({ ...prev, current: 1 }));
                }}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="children"
              >
                {machines.map(machine => (
                  <Option key={machine.id} value={machine.id}>
                    {machine.name}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.dateRange')}</Text>
              <RangePicker
                value={dateRange}
                onChange={(dates) => {
                  setDateRange(dates);
                  setPagination(prev => ({ ...prev, current: 1 }));
                }}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.columns.shift')}</Text>
              <Select
                placeholder={t('recordList.allShifts')}
                allowClear
                value={selectedShift}
                onChange={(value) => {
                  setSelectedShift(value);
                  setPagination(prev => ({ ...prev, current: 1 }));
                }}
                style={{ width: '100%' }}
              >
                <Option value="A">{t('shift.dayShift')}</Option>
                <Option value="B">{t('shift.nightShift')}</Option>
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.defectStatus')}</Text>
              <Select
                placeholder={t('recordList.defectStatusAll')}
                allowClear
                value={defectStatus}
                onChange={(value) => {
                  setDefectStatus(value ?? null);
                  setPagination(prev => ({ ...prev, current: 1 }));
                }}
                style={{ width: '100%' }}
              >
                <Option value="pending">{t('recordList.defectStatusPending')}</Option>
                <Option value="confirmed">{t('recordList.defectStatusConfirmed')}</Option>
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Space style={{ marginTop: 22 }}>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={() => {
                  setPagination(prev => ({ ...prev, current: 1 }));
                }}
              >
                {t('recordList.search')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={resetFilters}>
                {t('recordList.reset')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 데이터 테이블 */}
      <Card
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>
              {title || t('recordList.pageTitle')}
            </Title>
            <Text type="secondary">
              ({t('recordList.totalRecords', { count: pagination.total })})
            </Text>
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchRecords}
            loading={loading}
          >
            {t('recordList.refresh')}
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={records}
          rowKey="record_id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => t('recordList.totalRecords', { count: total }),
            onChange: (page, pageSize) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: pageSize || 20
              }));
            }
          }}
          scroll={{ x: 900 }}
          locale={{ emptyText: t('recordList.noRecords') }}
        />
      </Card>

      {/* NG 확정 전용 모달 — 다음날 불량 입력의 주 경로(/defect RPC) */}
      <Modal
        title={t('recordList.defectModal.title')}
        open={defectModalRecord !== null}
        onCancel={() => {
          setDefectModalRecord(null);
          setDefectQtyInput(null);
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setDefectModalRecord(null);
              setDefectQtyInput(null);
            }}
          >
            {t('recordList.editModal.cancel')}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={confirmingDefect}
            // 비어 있으면 확정할 수 없다 — "0건 확정"은 0 을 **명시적으로** 입력해야 한다.
            disabled={defectQtyInput === null}
            onClick={handleConfirmDefect}
          >
            {t('recordList.defectModal.confirm')}
          </Button>
        ]}
      >
        {defectModalRecord && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary">
              {defectModalRecord.machine?.name} · {defectModalRecord.date} ·{' '}
              {defectModalRecord.shift === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
            </Text>
            <Text>
              {t('recordList.columns.outputQty')}:{' '}
              <Text strong>{defectModalRecord.output_qty?.toLocaleString()} {t('common.pieces')}</Text>
            </Text>
            <InputNumber
              autoFocus
              value={defectQtyInput}
              onChange={setDefectQtyInput}
              min={0}
              max={defectModalRecord.output_qty}
              precision={0}
              style={{ width: '100%' }}
              size="large"
              addonAfter={t('common.pieces')}
              placeholder={t('recordList.defectModal.placeholder')}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('recordList.defectModal.hint')}
            </Text>
          </Space>
        )}
      </Modal>

      {/* 수정 모달 */}
      <Modal
        title={t('recordList.editModal.title')}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingRecord(null);
          editForm.resetFields();
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setEditModalVisible(false);
              setEditingRecord(null);
              editForm.resetFields();
            }}
          >
            {t('recordList.editModal.cancel')}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            onClick={handleEditSave}
          >
            {t('recordList.editModal.save')}
          </Button>
        ]}
      >
        {editingRecord && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>{t('recordList.editModal.recordInfo')}</Text>
            <div style={{
              marginTop: 8,
              padding: 12,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadius
            }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.machine')}: </Text>
                  <Text>{editingRecord.machine?.name || '-'}</Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.date')}: </Text>
                  <Text>{editingRecord.date}</Text>
                </Col>
              </Row>
              <Row gutter={16} style={{ marginTop: 4 }}>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.shift')}: </Text>
                  <Tag color={editingRecord.shift === 'A' ? 'orange' : 'blue'}>
                    {editingRecord.shift === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
                  </Tag>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.recordId')}: </Text>
                  <Text code style={{ fontSize: 11 }}>{editingRecord.record_id}</Text>
                </Col>
              </Row>
            </div>
          </div>
        )}
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="output_qty"
            label={t('recordList.editModal.outputQty')}
            rules={[
              { required: true, message: t('recordList.editModal.outputQtyRequired') },
              { type: 'number', min: 0, message: t('recordList.editModal.minZero') }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={0}
              addonAfter={t('common.pieces')}
            />
          </Form.Item>
          {/*
            미검사 행에서는 불량 칸을 **필수로 만들지 않는다**. 필수로 두면 생산량 한 자리를
            고치려는 사람이 아무 숫자나 넣어야 하고, 그 숫자가 곧 "검사 완료" 확정이 된다.
            비워 두면 미검사 상태가 그대로 유지된다(위 payload 주석 참고).
          */}
          <Form.Item
            name="defect_qty"
            label={t('recordList.editModal.defectQty')}
            dependencies={['output_qty']}
            extra={
              editingRecord?.defect_qty === null || editingRecord?.defect_qty === undefined
                ? t('recordList.editModal.defectQtyPendingHint')
                : undefined
            }
            rules={[
              // 이미 확정된 값이 있는 행에서만 필수다 — 확정 불량을 실수로 지우지 못하게.
              {
                required: !(editingRecord?.defect_qty === null || editingRecord?.defect_qty === undefined),
                message: t('recordList.editModal.defectQtyRequired')
              },
              { type: 'number', min: 0, message: t('recordList.editModal.minZero') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value !== undefined && value > getFieldValue('output_qty')) {
                    return Promise.reject(new Error(t('recordList.editModal.defectExceedsOutput')));
                  }
                  return Promise.resolve();
                }
              })
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={0}
              addonAfter={t('common.pieces')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProductionRecordList;
